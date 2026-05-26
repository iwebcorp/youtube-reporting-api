import * as fs from "fs";
import * as path from "path";

// Check exactly what isNeighboringRecord returns for a sample of assets in the raw ad file
const cacheFilePath = path.resolve(process.cwd(), "asset_metadata_cache.json");
const publishingAssetIdsPath = path.resolve(process.cwd(), "publishing_asset_ids.json");

interface AssetMetadata {
  assetId: string;
  sourceCategory?: "Publishing" | "Neighboring";
  iswc?: string;
  hfa?: string;
  isrc?: string;
  upc?: string;
  writers?: string;
  artist?: string;
}

const metadataCache: Record<string, AssetMetadata> = JSON.parse(fs.readFileSync(cacheFilePath, "utf-8"));
const publishingAssetIds = new Set<string>();
const parsed = JSON.parse(fs.readFileSync(publishingAssetIdsPath, "utf-8"));
if (Array.isArray(parsed)) parsed.forEach((id: unknown) => publishingAssetIds.add(String(id).trim()));

const publishingSet = new Set<string>();
const neighboringSet = new Set<string>();
for (const [assetId, metadata] of Object.entries(metadataCache)) {
  if (metadata.sourceCategory === "Publishing") publishingSet.add(assetId);
  if (metadata.sourceCategory === "Neighboring") neighboringSet.add(assetId);
  if (metadata.iswc || metadata.hfa || (metadata.writers && metadata.writers !== "Unidentified Writers" && !metadata.isrc)) publishingSet.add(assetId);
  if (metadata.isrc || metadata.upc) neighboringSet.add(assetId);
}

function classify(assetId: string): "Publishing" | "Neighboring" | "Unknown" {
  const metadata = metadataCache[assetId];
  if (metadata?.sourceCategory === "Publishing") return "Publishing";
  if (metadata?.sourceCategory === "Neighboring") return "Neighboring";
  if (publishingSet.has(assetId)) return "Publishing";
  if (neighboringSet.has(assetId)) return "Neighboring";
  if (metadata) {
    const writers = metadata.writers;
    if (metadata.iswc || metadata.hfa || (writers && writers !== "Unidentified Writers")) return "Publishing";
    const artist = metadata.artist;
    if (metadata.isrc || metadata.upc || (artist && artist !== "Various Artists")) return "Neighboring";
  }
  return "Unknown";
}

// The ACTUAL isNeighboringRecord logic from extractCsvs.ts
function isNeighboringRecord(assetId: string): boolean {
  if (publishingAssetIds.has(assetId)) return false;
  return classify(assetId) === "Neighboring";
}

// Read first 20 rows of the raw ad file and check them
const rawFile = path.resolve(process.cwd(), "reports/system-managed/202604_content_owner_asset_ad_revenue_raw_a1_20260401_20260501_20260506.csv");
const lines = fs.readFileSync(rawFile, "utf-8").split("\n");
const header = lines[0]!.split(",");
const assetIdCol = header.indexOf("asset_id");
const dateCol = header.indexOf("date");
const partnerRevenueCol = header.indexOf("partner_revenue");

console.log(`header cols: assetId=${assetIdCol}, date=${dateCol}, partnerRevenue=${partnerRevenueCol}`);
console.log(`\nFirst 20 data rows classification:`);

for (let i = 1; i <= 20 && i < lines.length; i++) {
  const row = lines[i]!.split(",");
  const assetId = row[assetIdCol]?.trim() ?? "";
  const date = row[dateCol]?.trim() ?? "";
  const rev = row[partnerRevenueCol]?.trim() ?? "";
  
  const isNeigh = isNeighboringRecord(assetId);
  const cls = classify(assetId);
  const inPubList = publishingAssetIds.has(assetId);
  
  console.log(`Row ${i}: assetId=${assetId}, date=${date}, rev=${rev}, classify=${cls}, inPubList=${inPubList}, isNeighboring=${isNeigh}`);
}

// Now check: in writeNeighboringAdRow, there's a date filter
// row["day"]?.trim() || row["date"]?.trim()
// But parseCsvRows returns rows with column names as-is from header
// The raw file has "date" column, which maps to row["date"]
// yearMonth is "202604", date is like "20260423" -> startsWith("202604") = true ✓
// So the date filter should be fine

// Let's also check the actual parseCsvRows behavior - it uses csv-parse with `columns: true`
// which uses the header row as-is for keys
// So row["asset_id"] should work if header is "asset_id"
// But row["day"] would NOT work because header is "date" not "day"!
// The code does: row["day"]?.trim() || row["date"]?.trim()
// So it falls to row["date"] - fine.

// But there IS one critical issue: in writeNeighboringAdRow line 301:
// const day = row["day"]?.trim() || row["date"]?.trim() || "";
// if (day && !day.startsWith(yearMonth)) { return; }
// The yearMonth for 202604 extraction - let me verify

console.log("\n\nChecking yearMonth logic:");
console.log("yearMonth = '202604'");
console.log("sample date = '20260423'");
console.log("'20260423'.startsWith('202604') =", "20260423".startsWith("202604"));
// This is TRUE, so date filter does NOT block data

// The real question is: does parseCsvRows actually work correctly?
// Let's check the adjustment file (small) to confirm
const adjFile = path.resolve(process.cwd(), "reports/system-managed/202604_content_owner_asset_ad_adjustment_revenue_raw_a1_20260401__20260506.csv");
const adjLines = fs.readFileSync(adjFile, "utf-8").split("\n");
const adjHeader = adjLines[0]!.split(",");
console.log("\nAdjustment file header:", adjHeader.join(" | "));
console.log("Adjustment file rows:", adjLines.length - 1);
const adjDateCol = adjHeader.indexOf("day") !== -1 ? adjHeader.indexOf("day") : adjHeader.indexOf("date");
const adjYearMonth = adjHeader[adjDateCol];
console.log(`Date column name: ${adjYearMonth} (idx ${adjDateCol})`);

// Sample a few adj rows
for (let i = 1; i <= 5 && i < adjLines.length; i++) {
  const row = adjLines[i]!.split(",");
  const date = row[adjDateCol]?.trim() ?? "";
  const assetIdIdx = adjHeader.indexOf("asset_id");
  const assetId = row[assetIdIdx]?.trim() ?? "";
  console.log(`Adj Row ${i}: assetId=${assetId}, date=${date}, isDate202604=${date.startsWith("202604")}`);
}
