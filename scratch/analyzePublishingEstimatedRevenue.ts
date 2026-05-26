import * as fs from "fs";
import * as path from "path";
import { AssetClassifier } from "../src/assetClassifier.js";
import { parseCsvRows } from "../src/reporting/parsers.js";

function fileNameMatchesYearMonth(fileName: string, yearMonth: string): boolean {
  const firstDateToken = fileName.match(/\d{4}-\d{2}|\d{8}|\d{6}/)?.[0];
  if (!firstDateToken) {
    return false;
  }
  return firstDateToken.replace(/-/g, "").startsWith(yearMonth);
}

function isPublishingRecord(
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  assetId: string,
  customId?: string,
): boolean {
  if (publishingAssetIds.has(assetId)) {
    return true;
  }
  const customIdCategory = classifier.classifyCustomId(customId ?? "");
  if (customIdCategory === "Publishing") {
    return true;
  }
  if (customIdCategory === "Neighboring") {
    return false;
  }
  const metadata = classifier.getMetadata(assetId);
  if (metadata.sourceCategory === "Publishing") {
    return true;
  }
  if (metadata.sourceCategory === "Neighboring") {
    return false;
  }
  if (metadata.iswc || metadata.hfa) {
    return true;
  }
  if (!metadata.isrc && metadata.writers !== "Unidentified Writers") {
    return true;
  }
  return false;
}

function loadPublishingAssetIds(): Set<string> {
  const filePath = path.resolve(process.cwd(), "publishing_asset_ids.json");
  if (!fs.existsSync(filePath)) {
    return new Set<string>();
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as string[];
  return new Set(parsed.map((value) => value.trim()).filter(Boolean));
}

function accumulate(
  map: Map<string, number>,
  key: string,
  value: number,
): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

async function run(): Promise<void> {
  const yearMonth = process.argv[2] ?? "202604";
  const reportDir = path.resolve(process.cwd(), "reports");
  const classifier = new AssetClassifier();
  await classifier.initialize({
    neighboringDir: path.resolve(process.cwd(), "인접"),
    publishingDir: path.resolve(process.cwd(), "저작"),
    cacheFile: path.resolve(process.cwd(), "asset_metadata_cache_split.json"),
  });
  const publishingAssetIds = loadPublishingAssetIds();

  const files = fs
    .readdirSync(reportDir)
    .filter((fileName) => fileName.includes("content_owner_asset_estimated_revenue_a1"))
    .filter((fileName) => fileName.endsWith(".csv"))
    .filter((fileName) => fileNameMatchesYearMonth(fileName, yearMonth))
    .sort();

  const byCountry = new Map<string, number>();
  const byUploader = new Map<string, number>();
  const byClaimed = new Map<string, number>();
  const byCountryUploader = new Map<string, number>();
  const byPrefix = new Map<string, number>();
  const byPrefixCountryUploader = new Map<string, number>();

  let total = 0;
  for (const fileName of files) {
    const rows = await parseCsvRows(path.join(reportDir, fileName));
    for (const row of rows) {
      const assetId = (row["asset_id"] ?? "").trim();
      if (!assetId) {
        continue;
      }
      const metadata = classifier.getMetadata(assetId);
      if (!isPublishingRecord(classifier, publishingAssetIds, assetId, metadata.customId)) {
        continue;
      }
      const revenue = Number((row["estimated_partner_ad_revenue"] ?? "0").trim()) || 0;
      if (revenue === 0) {
        continue;
      }
      const country = (row["country_code"] ?? "").trim() || "(blank)";
      const uploader = (row["uploader_type"] ?? "").trim() || "(blank)";
      const claimed = (row["claimed_status"] ?? "").trim() || "(blank)";
      const prefix = (metadata.customId ?? "").trim().slice(0, 3) || "(blank)";
      total += revenue;
      accumulate(byCountry, country, revenue);
      accumulate(byUploader, uploader, revenue);
      accumulate(byClaimed, claimed, revenue);
      accumulate(byCountryUploader, `${country}|${uploader}|${claimed}`, revenue);
      accumulate(byPrefix, prefix, revenue);
      accumulate(byPrefixCountryUploader, `${prefix}|${country}|${uploader}|${claimed}`, revenue);
    }
  }

  console.log(`[AnalyzePublishingEstimatedRevenue] total=${total.toFixed(12)} files=${files.length}`);
  for (const [label, map] of [
    ["country", byCountry],
    ["uploader", byUploader],
    ["claimed", byClaimed],
    ["countryUploaderClaimed", byCountryUploader],
    ["prefix", byPrefix],
    ["prefixCountryUploaderClaimed", byPrefixCountryUploader],
  ] as const) {
    console.log(`\n[AnalyzePublishingEstimatedRevenue] group=${label}`);
    for (const [key, value] of Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`${key}\t${value.toFixed(12)}`);
    }
  }
}

run().catch((error) => {
  console.error("[AnalyzePublishingEstimatedRevenue] Failed.", error);
  process.exitCode = 1;
});
