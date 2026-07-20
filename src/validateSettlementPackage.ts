import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { pathToFileURL } from "url";
import iconv from "iconv-lite";
import { sumApiSettlementTotal } from "./extractApiSettlementSummary.js";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  if (delimiter === "\t") {
    return line.split("\t");
  }

  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

async function sumPartnerRevenueCsv(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const text = iconv.decode(fs.readFileSync(filePath), "cp949").replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const headerLine = lines[0] === "Asset Summary" ? lines[1] : lines[0];
  if (!headerLine) {
    return 0;
  }

  const header = parseDelimitedLine(headerLine.replace(/^\uFEFF/, ""), ",").map((value) => value.trim());
  const headerIndex = header.findIndex((value) => value === "Partner Revenue");
  if (headerIndex < 0) {
    return 0;
  }

  let total = 0;
  const rowStartIndex = lines[0] === "Asset Summary" ? 2 : 1;
  for (const line of lines.slice(rowStartIndex)) {
    const values = parseDelimitedLine(line, ",");
    total += Number(values[headerIndex] ?? 0);
  }

  return total;
}

async function sumShortsSummary(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const text = iconv.decode(fs.readFileSync(filePath), "cp949").replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) {
    return 0;
  }
  const header = parseDelimitedLine(lines[0].replace(/^\uFEFF/, ""), ",").map((value) => value.trim());
  const headerIndex = header.findIndex((value) => value === "Shorts Flat Fee Revenue USD");
  if (headerIndex < 0) {
    return 0;
  }

  let total = 0;
  for (const line of lines.slice(1)) {
    const values = parseDelimitedLine(line, ",");
    total += Number(values[headerIndex] ?? 0);
  }
  return total;
}

async function sumDdexAudioTier(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const firstLine = fs.readFileSync(filePath, "utf-8").split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("Partner Revenue")) {
    return sumPartnerRevenueCsv(filePath);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let detailTotal = 0;
  let detailRows = 0;
  let summaryTotal = 0;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "").replace(/\r$/, "");
    if (line.startsWith("SR02\t")) {
      const values = parseDelimitedLine(line, "\t");
      detailTotal += Number(values[20] ?? 0);
      detailRows += 1;
    } else if (line.startsWith("GSY09\t")) {
      const values = parseDelimitedLine(line, "\t");
      summaryTotal += Number(values[6] ?? 0);
    }
  }
  return detailRows > 0 ? detailTotal : summaryTotal;
}

export async function runSettlementValidation(cliArgs: string[] = process.argv.slice(2)): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const outputDir = config.outputDir;

  const fileSums = {
    neighboringDailyAd: await sumPartnerRevenueCsv(path.join(outputDir, "1_neighboring_daily_ad.csv")),
    publishingDailyAd: await sumPartnerRevenueCsv(path.join(outputDir, "1_publishing_daily_ad.csv")),
    neighboringDailyAdj: await sumPartnerRevenueCsv(path.join(outputDir, "2_neighboring_daily_ad_adj.csv")),
    publishingDailyAdj: await sumPartnerRevenueCsv(path.join(outputDir, "2_publishing_daily_ad_adj.csv")),
    neighboringMonthlySub: await sumPartnerRevenueCsv(path.join(outputDir, "3_neighboring_monthly_sub.csv")),
    publishingMonthlySub: await sumPartnerRevenueCsv(path.join(outputDir, "3_publishing_monthly_sub.csv")),
    neighboringFinancial: await sumPartnerRevenueCsv(path.join(outputDir, "4_neighboring_financial_detail.csv")),
    publishingDdex: await sumDdexAudioTier(path.join(outputDir, "4_publishing_ddex_dsr.csv")),
    publishingShorts: await sumShortsSummary(path.join(outputDir, "5_publishing_shorts_revenue_summary.csv")),
  };

  const mainPackageTotal =
    fileSums.neighboringDailyAd +
    fileSums.neighboringDailyAdj +
    fileSums.neighboringMonthlySub +
    fileSums.neighboringFinancial +
    fileSums.publishingShorts;
  const publishingReferenceTotal =
    fileSums.publishingDailyAd +
    fileSums.publishingDailyAdj +
    fileSums.publishingMonthlySub +
    fileSums.publishingDdex;
  const apiTotal = await sumApiSettlementTotal(config.yearMonth, config.systemManagedDir);
  const difference = mainPackageTotal - apiTotal;

  console.log("[ValidateSettlement] Package sum by file");
  for (const [key, value] of Object.entries(fileSums)) {
    console.log(`- ${key}=${value.toFixed(9)}`);
  }
  console.log(`- mainPackageTotal=${mainPackageTotal.toFixed(9)}`);
  console.log(`- publishingReferenceTotal=${publishingReferenceTotal.toFixed(9)}`);
  console.log(`- apiTotal=${apiTotal.toFixed(9)}`);
  console.log(`- difference=${difference.toFixed(9)}`);

  if (Math.abs(difference) > 0.000001) {
    throw new Error(`[ValidateSettlement] Main package total does not match API total. difference=${difference}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runSettlementValidation().catch((error) => {
    console.error("[ValidateSettlement] Validation failed.", error);
    process.exitCode = 1;
  });
}
