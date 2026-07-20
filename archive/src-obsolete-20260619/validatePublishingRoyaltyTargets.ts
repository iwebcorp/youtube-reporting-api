import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { pathToFileURL } from "url";
import iconv from "iconv-lite";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

interface PublishingRoyaltyTargetsFile {
  yearMonth: string;
  targets: {
    publishing_daily_ad: number;
    publishing_daily_ad_adj: number;
    publishing_monthly_sub: number;
    publishing_ddex_dsr: number;
    publishing_total: number;
  };
  current_findings?: Record<string, { status?: string; notes?: string[] }>;
}

type PublishingRoyaltyActuals = PublishingRoyaltyTargetsFile["targets"];

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

function loadTargets(targetsPath: string): PublishingRoyaltyTargetsFile {
  const raw = fs.readFileSync(targetsPath, "utf-8");
  return JSON.parse(raw) as PublishingRoyaltyTargetsFile;
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

  const rowStartIndex = lines[0] === "Asset Summary" ? 2 : 1;
  let total = 0;
  for (const line of lines.slice(rowStartIndex)) {
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

  let total = 0;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "").replace(/\r$/, "");
    if (!line.startsWith("GSY09\t")) {
      continue;
    }
    const values = parseDelimitedLine(line, "\t");
    const rightsType = values[9] ?? "";
    if (rightsType !== "MechanicalRight") {
      continue;
    }
    total += Number(values[6] ?? 0);
  }

  return total;
}

async function collectActuals(outputDir: string): Promise<PublishingRoyaltyActuals> {
  const publishing_daily_ad = await sumPartnerRevenueCsv(path.join(outputDir, "1_publishing_daily_ad.csv"));
  const publishing_daily_ad_adj = await sumPartnerRevenueCsv(path.join(outputDir, "2_publishing_daily_ad_adj.csv"));
  const publishing_monthly_sub = await sumPartnerRevenueCsv(path.join(outputDir, "3_publishing_monthly_sub.csv"));
  const publishing_ddex_dsr = await sumDdexAudioTier(path.join(outputDir, "4_publishing_ddex_dsr.csv"));

  return {
    publishing_daily_ad,
    publishing_daily_ad_adj,
    publishing_monthly_sub,
    publishing_ddex_dsr,
    publishing_total:
      publishing_daily_ad + publishing_daily_ad_adj + publishing_monthly_sub + publishing_ddex_dsr,
  };
}

function printComparison(
  targets: PublishingRoyaltyTargetsFile,
  actuals: PublishingRoyaltyActuals,
): { maxAbsDiff: number } {
  let maxAbsDiff = 0;
  console.log("[ValidatePublishingRoyalty] Target comparison");
  for (const key of Object.keys(targets.targets) as Array<keyof PublishingRoyaltyActuals>) {
    const expected = targets.targets[key];
    const actual = actuals[key];
    const diff = actual - expected;
    maxAbsDiff = Math.max(maxAbsDiff, Math.abs(diff));
    const status = targets.current_findings?.[key];
    const suffix = status?.status ? ` | status=${status.status}` : "";
    console.log(
      `- ${key}: actual=${actual.toFixed(9)} | target=${expected.toFixed(9)} | diff=${diff.toFixed(9)}${suffix}`,
    );
  }
  return { maxAbsDiff };
}

export async function runPublishingRoyaltyValidation(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const targetsPath = path.resolve(process.cwd(), `publishing_royalty_${config.yearMonth}_targets.json`);

  if (!fs.existsSync(targetsPath)) {
    throw new Error(`[ValidatePublishingRoyalty] Missing target file: ${targetsPath}`);
  }

  const targets = loadTargets(targetsPath);
  if (targets.yearMonth !== config.yearMonth) {
    throw new Error(
      `[ValidatePublishingRoyalty] Target file yearMonth mismatch. expected=${config.yearMonth} actual=${targets.yearMonth}`,
    );
  }

  const actuals = await collectActuals(config.outputDir);
  const { maxAbsDiff } = printComparison(targets, actuals);

  console.log(`- outputDir=${config.outputDir}`);
  console.log(`- maxAbsDiff=${maxAbsDiff.toFixed(9)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPublishingRoyaltyValidation().catch((error) => {
    console.error("[ValidatePublishingRoyalty] Validation failed.", error);
    process.exitCode = 1;
  });
}
