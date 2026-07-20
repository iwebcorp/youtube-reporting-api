import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

interface CandidateEntry {
  titles: string[];
}

interface CandidateFile {
  publishing_daily_ad: CandidateEntry;
  publishing_monthly_sub: CandidateEntry;
  publishing_ddex_dsr: CandidateEntry;
}

interface Summary {
  rows: number;
  total: number;
  byCountry: Map<string, { rows: number; total: number }>;
  byAssetType: Map<string, { rows: number; total: number }>;
  byAdminister: Map<string, { rows: number; total: number }>;
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
  if (!matched) throw new Error(`No CMS file matched for ${yearMonth}`);
  return path.join(cmsDir, matched);
}

function add(summary: Summary, country: string, revenue: number): void {
  summary.rows += 1;
  summary.total += revenue;
  const key = country || "(blank)";
  const bucket = summary.byCountry.get(key) ?? { rows: 0, total: 0 };
  bucket.rows += 1;
  bucket.total += revenue;
  summary.byCountry.set(key, bucket);
}

function addBucket(map: Map<string, { rows: number; total: number }>, rawKey: string, revenue: number): void {
  const key = rawKey || "(blank)";
  const bucket = map.get(key) ?? { rows: 0, total: 0 };
  bucket.rows += 1;
  bucket.total += revenue;
  map.set(key, bucket);
}

async function summarizeCsv(
  filePath: string,
  options: {
    titles?: string[];
    skipLeadingSummaryLine?: boolean;
    country?: string;
    assetType?: string;
    administer?: string;
  } = {},
): Promise<Summary> {
  const titleSet = options.titles ? new Set(options.titles.map((title) => title.trim())) : null;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  const summary: Summary = { rows: 0, total: 0, byCountry: new Map(), byAssetType: new Map(), byAdminister: new Map() };
  let headers: string[] | null = null;
  let skippedSummary = false;
  let titleIndex = -1;
  let countryIndex = -1;
  let revenueIndex = -1;
  let assetTypeIndex = -1;
  let administerIndex = -1;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) continue;
    if (options.skipLeadingSummaryLine && !skippedSummary && line === "Asset Summary") {
      skippedSummary = true;
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line);
      titleIndex = headers.findIndex((header) => header === "Asset Title");
      countryIndex = headers.findIndex((header) => header === "Country");
      revenueIndex = headers.findIndex((header) => header === "Partner Revenue");
      assetTypeIndex = headers.findIndex((header) => header === "Asset Type");
      administerIndex = headers.findIndex((header) => header === "Administer Publish Rights");
      if (revenueIndex < 0) throw new Error(`Missing Partner Revenue: ${filePath}`);
      continue;
    }

    const values = parseCsvLine(line);
    if (values.length !== headers.length) continue;
    const title = titleIndex >= 0 ? String(values[titleIndex] ?? "").trim() : "";
    const country = countryIndex >= 0 ? String(values[countryIndex] ?? "").trim() : "";
    const assetType = assetTypeIndex >= 0 ? String(values[assetTypeIndex] ?? "").trim() : "";
    const administer = administerIndex >= 0 ? String(values[administerIndex] ?? "").trim() : "";
    if (titleSet && !titleSet.has(title)) continue;
    if (options.country && country !== options.country) continue;
    if (options.assetType && assetType !== options.assetType) continue;
    if (options.administer && administer !== options.administer) continue;
    const revenue = Number(values[revenueIndex] ?? "0");
    if (!Number.isFinite(revenue)) continue;
    add(summary, country, revenue);
    addBucket(summary.byAssetType, assetType, revenue);
    addBucket(summary.byAdminister, administer, revenue);
  }

  return summary;
}

function printSummary(label: string, summary: Summary): void {
  console.log(`${label}: rows=${summary.rows} total=${summary.total.toFixed(12)}`);
  for (const [country, bucket] of [...summary.byCountry.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 12)) {
    console.log(`  ${country}: rows=${bucket.rows} total=${bucket.total.toFixed(12)}`);
  }
  for (const [assetType, bucket] of [...summary.byAssetType.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 8)) {
    console.log(`  assetType=${assetType}: rows=${bucket.rows} total=${bucket.total.toFixed(12)}`);
  }
  for (const [administer, bucket] of [...summary.byAdminister.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 8)) {
    console.log(`  administer=${administer}: rows=${bucket.rows} total=${bucket.total.toFixed(12)}`);
  }
}

async function main(): Promise<void> {
  const yearMonth = "202605";
  const cmsDir = path.resolve(process.cwd(), "202605cms");
  const candidates = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), `publishing_royalty_${yearMonth}_cms_title_candidates.json`), "utf8"),
  ) as CandidateFile;

  const adPath = findCmsFile(cmsDir, yearMonth, (fileName) => fileName.includes("_asset_raw_") && !fileName.includes("ADJ") && !fileName.includes("red_label"));
  const adjPath = findCmsFile(cmsDir, yearMonth, (fileName) => fileName.includes("_ADJ_asset_raw_"));
  const subPath = findCmsFile(cmsDir, yearMonth, (fileName) => fileName.includes("red_label_rawdata_asset"));
  const audioPath = findCmsFile(cmsDir, yearMonth, (fileName) => fileName.includes("Audio_Tier_") && fileName.includes("Financial_Detail"));

  printSummary("ad selected titles", await summarizeCsv(adPath, { titles: candidates.publishing_daily_ad.titles }));
  printSummary("ad selected titles KR", await summarizeCsv(adPath, { titles: candidates.publishing_daily_ad.titles, country: "KR" }));
  printSummary("ad KR all", await summarizeCsv(adPath, { country: "KR" }));
  printSummary("ad KR administer yes", await summarizeCsv(adPath, { country: "KR", administer: "yes" }));
  printSummary("ad KR composition", await summarizeCsv(adPath, { country: "KR", assetType: "Composition" }));
  printSummary("adj all", await summarizeCsv(adjPath));
  printSummary("adj KR", await summarizeCsv(adjPath, { country: "KR" }));
  printSummary("sub selected titles", await summarizeCsv(subPath, { titles: candidates.publishing_monthly_sub.titles, skipLeadingSummaryLine: true }));
  printSummary("sub selected titles KR", await summarizeCsv(subPath, { titles: candidates.publishing_monthly_sub.titles, skipLeadingSummaryLine: true, country: "KR" }));
  printSummary("sub selected titles GE", await summarizeCsv(subPath, { titles: candidates.publishing_monthly_sub.titles, skipLeadingSummaryLine: true, country: "GE" }));
  printSummary("audio selected titles", await summarizeCsv(audioPath, { titles: candidates.publishing_ddex_dsr.titles }));
  printSummary("audio selected titles KR", await summarizeCsv(audioPath, { titles: candidates.publishing_ddex_dsr.titles, country: "KR" }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
