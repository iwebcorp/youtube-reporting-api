import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

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

console.log("Loading metadata cache...");
const metadataCache: Record<string, AssetMetadata> = fs.existsSync(cacheFilePath)
  ? JSON.parse(fs.readFileSync(cacheFilePath, "utf-8"))
  : {};

console.log("Loading publishing asset ids...");
const publishingAssetIds = new Set<string>();
if (fs.existsSync(publishingAssetIdsPath)) {
  const parsed = JSON.parse(fs.readFileSync(publishingAssetIdsPath, "utf-8"));
  if (Array.isArray(parsed)) {
    parsed.forEach(id => publishingAssetIds.add(String(id).trim()));
  }
}

const neighboringAssetsFromCache = new Set<string>();
const publishingAssetsFromCache = new Set<string>();

for (const [assetId, metadata] of Object.entries(metadataCache)) {
  const sourceCategory = metadata.sourceCategory;
  if (sourceCategory === "Publishing") {
    publishingAssetsFromCache.add(assetId);
  }
  if (sourceCategory === "Neighboring") {
    neighboringAssetsFromCache.add(assetId);
  }
  if (
    metadata.iswc ||
    metadata.hfa ||
    (metadata.writers && metadata.writers !== "Unidentified Writers" && !metadata.isrc)
  ) {
    publishingAssetsFromCache.add(assetId);
  }
  if (metadata.isrc || metadata.upc) {
    neighboringAssetsFromCache.add(assetId);
  }
}

function classify(assetId: string): "Publishing" | "Neighboring" | "Unknown" {
  const metadata = metadataCache[assetId];
  if (metadata?.sourceCategory === "Publishing") return "Publishing";
  if (metadata?.sourceCategory === "Neighboring") return "Neighboring";

  if (publishingAssetsFromCache.has(assetId)) return "Publishing";
  if (neighboringAssetsFromCache.has(assetId)) return "Neighboring";

  if (metadata) {
    const writers = metadata.writers;
    if (metadata.iswc || metadata.hfa || (writers && writers !== "Unidentified Writers")) {
      return "Publishing";
    }
    const artist = metadata.artist;
    if (metadata.isrc || metadata.upc || (artist && artist !== "Various Artists")) {
      return "Neighboring";
    }
  }

  return "Unknown";
}

function isPublishingRecord(assetId: string): boolean {
  if (publishingAssetIds.has(assetId)) {
    return true;
  }
  if (classify(assetId) === "Publishing") {
    return true;
  }
  const metadata = metadataCache[assetId];
  if (metadata) {
    const writers = metadata.writers;
    const artist = metadata.artist;
    if (!metadata.isrc && (writers !== "Unidentified Writers" || artist !== "Various Artists")) {
      return true;
    }
  }
  return false;
}

function isNeighboringRecord(assetId: string): boolean {
  if (publishingAssetIds.has(assetId)) {
    return false;
  }
  return classify(assetId) === "Neighboring";
}

// Quick CSV parser for a single line that handles quotes correctly
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(s => s.trim());
}

async function processFile(filePath: string, dateFilter: string | null = null): Promise<{
  total: number;
  pub: number;
  neigh: number;
  unknown: number;
  missingAssetId: number;
}> {
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return { total: 0, pub: 0, neigh: 0, unknown: 0, missingAssetId: 0 };
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let headers: string[] = [];
  let assetIdIdx = -1;
  let partnerRevenueIdx = -1;
  let dayIdx = -1;
  let adjustmentTypeIdx = -1;

  let total = 0;
  let pub = 0;
  let neigh = 0;
  let unknown = 0;
  let missingAssetId = 0;

  let isFirstLine = true;

  for await (const line of rl) {
    if (isFirstLine) {
      headers = parseCsvLine(line.toLowerCase());
      assetIdIdx = headers.findIndex(h => h === "asset id" || h === "asset_id");
      partnerRevenueIdx = headers.findIndex(h => h === "partner revenue" || h === "partner_revenue" || h === "partner_revenue_usd" || h === "partner revenue usd");
      dayIdx = headers.findIndex(h => h === "day" || h === "date");
      adjustmentTypeIdx = headers.findIndex(h => h === "adjustment type" || h === "adjustment_type");

      if (assetIdIdx === -1 || partnerRevenueIdx === -1) {
        console.error(`Error: Could not find asset id or partner revenue headers in ${path.basename(filePath)}`);
        console.error(`Headers found:`, headers);
        break;
      }
      isFirstLine = false;
      continue;
    }

    const row = parseCsvLine(line);
    if (row.length <= Math.max(assetIdIdx, partnerRevenueIdx)) {
      continue;
    }

    const assetId = row[assetIdIdx];
    const revenue = parseFloat(row[partnerRevenueIdx]) || 0;

    // Filter by date if requested (mostly for adjustment files where day matters)
    if (dateFilter && dayIdx !== -1) {
      const day = row[dayIdx];
      if (day && !day.startsWith(dateFilter)) {
        continue;
      }
    }

    if (!assetId) {
      missingAssetId += revenue;
      continue;
    }

    total += revenue;
    if (isPublishingRecord(assetId)) {
      pub += revenue;
    } else if (isNeighboringRecord(assetId)) {
      neigh += revenue;
    } else {
      unknown += revenue;
    }
  }

  return { total, pub, neigh, unknown, missingAssetId };
}

async function run() {
  const yearMonth = "202604";
  const systemManagedDir = path.resolve(process.cwd(), "reports/system-managed");

  // Define files manually from the list
  const adFile = path.join(systemManagedDir, "202604_content_owner_asset_ad_revenue_raw_a1_20260401_20260501_20260506.csv");
  const adjFile = path.join(systemManagedDir, "202604_content_owner_asset_ad_adjustment_revenue_raw_a1_20260401__20260506.csv");
  const redFile = path.join(systemManagedDir, "202604_music_content_owner_asset_red_revenue_raw_a1_20260401_20260501_20260506.csv");
  const audioTierFile = path.join(systemManagedDir, "202604_content_owner_claim_audio_tier_revenue_raw_a1_20260401__20260505.csv");

  console.log("\n--- Processing Ads Revenue Raw ---");
  const adRes = await processFile(adFile);
  console.log(`Ad Revenue Raw totals:`, adRes);

  console.log("\n--- Processing Ads Adjustment Raw (WITHOUT Date Filter) ---");
  const adjResNoFilter = await processFile(adjFile);
  console.log(`Ad Adjustment Raw totals:`, adjResNoFilter);

  console.log("\n--- Processing Ads Adjustment Raw (WITH Date Filter: 202604) ---");
  const adjResFilter = await processFile(adjFile, "202604");
  console.log(`Ad Adjustment Raw totals:`, adjResFilter);

  console.log("\n--- Processing Subscription (Red) Revenue Raw ---");
  // For red file, let's also distinguish by adjustment type if possible
  const redRes = await processFile(redFile);
  console.log(`Red Revenue Raw totals:`, redRes);

  console.log("\n--- Processing Audio Tier Revenue Raw ---");
  const audioRes = await processFile(audioTierFile);
  console.log(`Audio Tier Revenue Raw totals:`, audioRes);

  console.log("\n================ SUMMARY ================");
  console.log(`Ad (No Filter): total=${adRes.total}, pub=${adRes.pub}, neigh=${adRes.neigh}, unknown=${adRes.unknown}`);
  console.log(`Adj (No Filter): total=${adjResNoFilter.total}, pub=${adjResNoFilter.pub}, neigh=${adjResNoFilter.neigh}, unknown=${adjResNoFilter.unknown}`);
  console.log(`Adj (With Filter): total=${adjResFilter.total}, pub=${adjResFilter.pub}, neigh=${adjResFilter.neigh}, unknown=${adjResFilter.unknown}`);
  console.log(`Red (No Filter): total=${redRes.total}, pub=${redRes.pub}, neigh=${redRes.neigh}, unknown=${redRes.unknown}`);
  console.log(`Audio Tier: total=${audioRes.total}, pub=${audioRes.pub}, neigh=${audioRes.neigh}, unknown=${audioRes.unknown}`);
}

run().catch(console.error);
