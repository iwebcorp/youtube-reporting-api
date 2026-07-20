import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

interface Summary {
  rows: number;
  total: number;
  byCountry: Map<string, { rows: number; total: number }>;
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

function latestSystemFile(token: string): string {
  const dir = path.resolve(process.cwd(), "reports", "system-managed");
  const files = fs.readdirSync(dir).filter((fileName) => fileName.startsWith("202605_") && fileName.includes(token)).sort();
  if (files.length === 0) throw new Error(`No system file: ${token}`);
  return path.join(dir, files[files.length - 1]!);
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

async function summarize(filePath: string, assetIds: Set<string>, options?: { skipLeadingSummaryLine?: boolean }): Promise<Summary> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const summary: Summary = { rows: 0, total: 0, byCountry: new Map() };
  let headers: string[] | null = null;
  let skippedSummary = false;
  let assetIndex = -1;
  let countryIndex = -1;
  let revenueIndex = -1;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) continue;
    if (options?.skipLeadingSummaryLine && !skippedSummary && line === "Asset Summary") {
      skippedSummary = true;
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line);
      assetIndex = headers.findIndex((header) => ["asset_id", "Asset ID"].includes(header));
      countryIndex = headers.findIndex((header) => ["country", "country_code", "Country"].includes(header));
      revenueIndex = headers.findIndex((header) => ["partner_revenue", "Partner Revenue", "audio_royalties"].includes(header));
      if (assetIndex < 0 || revenueIndex < 0) throw new Error(`Missing required columns in ${filePath}: ${headers.join("|")}`);
      continue;
    }
    const values = parseCsvLine(line);
    if (values.length !== headers.length) continue;
    const assetId = String(values[assetIndex] ?? "").trim();
    if (!assetIds.has(assetId)) continue;
    const country = countryIndex >= 0 ? String(values[countryIndex] ?? "").trim() : "";
    const revenue = Number(values[revenueIndex] ?? "0");
    if (!Number.isFinite(revenue)) continue;
    add(summary, country, revenue);
  }
  return summary;
}

function print(label: string, summary: Summary): void {
  const kr = summary.byCountry.get("KR")?.total ?? 0;
  const ge = summary.byCountry.get("GE")?.total ?? 0;
  console.log(`${label}: rows=${summary.rows} total=${summary.total.toFixed(12)} KR=${kr.toFixed(12)} GE=${ge.toFixed(12)}`);
  for (const [country, bucket] of [...summary.byCountry.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 10)) {
    console.log(`  ${country}: rows=${bucket.rows} total=${bucket.total.toFixed(12)}`);
  }
}

async function main(): Promise<void> {
  const assetIds = new Set(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "publishing_asset_ids.json"), "utf8")));
  print("ad", await summarize(latestSystemFile("content_owner_asset_ad_revenue_raw_a1"), assetIds));
  print("adj", await summarize(latestSystemFile("content_owner_asset_ad_adjustment_revenue_raw_a1"), assetIds));
  print("red", await summarize(latestSystemFile("music_content_owner_asset_red_revenue_raw_a1"), assetIds, { skipLeadingSummaryLine: true }));
  print("audio", await summarize(latestSystemFile("content_owner_claim_audio_tier_revenue_raw_a1"), assetIds));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
