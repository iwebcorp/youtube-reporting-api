import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { pathToFileURL } from "url";
import iconv from "iconv-lite";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
import { loadJson } from "./validatePublishingRoyaltyCandidates.js";

interface CmsTitleCandidateEntry {
  target: number;
  actual: number;
  diff: number;
  titles: string[];
}

interface CmsTitleCandidateFile {
  publishing_daily_ad: CmsTitleCandidateEntry;
  publishing_monthly_sub: CmsTitleCandidateEntry;
  publishing_ddex_dsr: CmsTitleCandidateEntry;
}

function parseOption(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseCsvLine(line: string): string[] {
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

function findCmsFile(cmsDir: string, yearMonth: string, matcher: (fileName: string) => boolean): string {
  const prefix = `${yearMonth}01`;
  const matched = fs.readdirSync(cmsDir).find((fileName) => fileName.includes(prefix) && matcher(fileName));
  if (!matched) {
    throw new Error(`[RewritePublishingRoyaltyDetail] No CMS file matched for ${yearMonth} in ${cmsDir}.`);
  }
  return path.join(cmsDir, matched);
}

function writeCsvLine(writer: fs.WriteStream, line: string): void {
  writer.write(iconv.encode(`${line}\r\n`, "cp949"));
}

async function rewriteByTitles(
  sourcePath: string,
  destinationPath: string,
  selectedTitles: string[],
  options?: { skipLeadingSummaryLine?: boolean },
): Promise<{ rows: number; total: number }> {
  const titleSet = new Set(selectedTitles.map((value) => value.trim()));
  const rl = readline.createInterface({
    input: fs.createReadStream(sourcePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const writer = fs.createWriteStream(destinationPath);

  let headers: string[] | null = null;
  let skippedSummary = false;
  let rows = 0;
  let total = 0;
  let partnerRevenueIndex = -1;
  let assetTitleIndex = -1;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) {
      continue;
    }
    if (options?.skipLeadingSummaryLine && !skippedSummary && line === "Asset Summary") {
      skippedSummary = true;
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line);
      partnerRevenueIndex = headers.findIndex((header) => header === "Partner Revenue");
      assetTitleIndex = headers.findIndex((header) => header === "Asset Title");
      if (partnerRevenueIndex < 0 || assetTitleIndex < 0) {
        throw new Error(`[RewritePublishingRoyaltyDetail] Missing required columns in ${sourcePath}`);
      }
      writeCsvLine(writer, line);
      continue;
    }

    const values = parseCsvLine(line);
    if (values.length !== headers.length) {
      continue;
    }
    const title = String(values[assetTitleIndex] ?? "").trim();
    if (!titleSet.has(title)) {
      continue;
    }
    const revenue = Number(values[partnerRevenueIndex] ?? "0");
    total += Number.isFinite(revenue) ? revenue : 0;
    rows += 1;
    writeCsvLine(writer, line);
  }

  await new Promise<void>((resolve, reject) => {
    writer.end(() => resolve());
    writer.once("error", reject);
  });

  return { rows, total };
}

async function copyCsv(
  sourcePath: string,
  destinationPath: string,
): Promise<{ rows: number; total: number }> {
  const rl = readline.createInterface({
    input: fs.createReadStream(sourcePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const writer = fs.createWriteStream(destinationPath);

  let headers: string[] | null = null;
  let rows = 0;
  let total = 0;
  let partnerRevenueIndex = -1;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) {
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line);
      partnerRevenueIndex = headers.findIndex((header) => header === "Partner Revenue");
      if (partnerRevenueIndex < 0) {
        throw new Error(`[RewritePublishingRoyaltyDetail] Missing Partner Revenue column in ${sourcePath}`);
      }
      writeCsvLine(writer, line);
      continue;
    }

    const values = parseCsvLine(line);
    if (values.length !== headers.length) {
      continue;
    }
    const revenue = Number(values[partnerRevenueIndex] ?? "0");
    total += Number.isFinite(revenue) ? revenue : 0;
    rows += 1;
    writeCsvLine(writer, line);
  }

  await new Promise<void>((resolve, reject) => {
    writer.end(() => resolve());
    writer.once("error", reject);
  });

  return { rows, total };
}

export async function runRewritePublishingRoyaltyDetailPackage(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const cmsDir = path.resolve(process.cwd(), parseOption(cliArgs, "cmsDir") ?? "from _cms");
  const candidatesPath = path.resolve(process.cwd(), `publishing_royalty_${config.yearMonth}_cms_title_candidates.json`);
  const candidates = loadJson<CmsTitleCandidateFile>(candidatesPath);

  const adPath = findCmsFile(
    cmsDir,
    config.yearMonth,
    (fileName) => fileName.includes("_asset_raw_") && !fileName.includes("ADJ") && !fileName.includes("red_label"),
  );
  const adjPath = findCmsFile(cmsDir, config.yearMonth, (fileName) => fileName.includes("_ADJ_asset_raw_"));
  const subPath = findCmsFile(cmsDir, config.yearMonth, (fileName) => fileName.includes("red_label_rawdata_asset"));
  const audioPath = findCmsFile(
    cmsDir,
    config.yearMonth,
    (fileName) => fileName.includes("Audio_Tier_") && fileName.includes("Financial_Detail"),
  );

  const ad = await rewriteByTitles(
    adPath,
    path.join(config.outputDir, "1_publishing_daily_ad.csv"),
    candidates.publishing_daily_ad.titles,
  );
  const adj = await copyCsv(adjPath, path.join(config.outputDir, "2_publishing_daily_ad_adj.csv"));
  const sub = await rewriteByTitles(
    subPath,
    path.join(config.outputDir, "3_publishing_monthly_sub.csv"),
    candidates.publishing_monthly_sub.titles,
    { skipLeadingSummaryLine: true },
  );
  const audio = await rewriteByTitles(
    audioPath,
    path.join(config.outputDir, "4_publishing_ddex_dsr.csv"),
    candidates.publishing_ddex_dsr.titles,
  );

  console.log(`[RewritePublishingRoyaltyDetail] Rewrote detailed publishing files for ${config.yearMonth}`);
  console.log(`- publishing_daily_ad rows=${ad.rows} total=${ad.total.toFixed(12)}`);
  console.log(`- publishing_daily_ad_adj rows=${adj.rows} total=${adj.total.toFixed(12)}`);
  console.log(`- publishing_monthly_sub rows=${sub.rows} total=${sub.total.toFixed(12)}`);
  console.log(`- publishing_ddex_dsr rows=${audio.rows} total=${audio.total.toFixed(12)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runRewritePublishingRoyaltyDetailPackage().catch((error) => {
    console.error("[RewritePublishingRoyaltyDetail] Rewrite failed.", error);
    process.exitCode = 1;
  });
}
