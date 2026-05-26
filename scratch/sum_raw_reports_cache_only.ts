import * as fs from "fs";
import * as path from "path";
import { parsePublishingFinancialFiles, parseRedSummaryFiles, parseAudioTierDetailFiles } from "../src/reporting/parsers.js";
import { listMonthlySystemManagedFiles } from "../src/reporting/utils.js";

// Load files directly to mimic AssetClassifier using cache only
const cacheFilePath = path.resolve(process.cwd(), "asset_metadata_cache.json");
const publishingAssetIdsPath = path.resolve(process.cwd(), "publishing_asset_ids.json");

interface AssetMetadata {
  assetId: string;
  title?: string;
  customId?: string;
  isrc?: string;
  iswc?: string;
  hfa?: string;
  upc?: string;
  writers?: string;
  artist?: string;
  album?: string;
  label?: string;
  assetType?: string;
  musicClaimType?: string;
  compositionRightType?: string;
  channelId?: string;
  sourceCategory?: "Publishing" | "Neighboring";
}

const metadataCache: Record<string, AssetMetadata> = fs.existsSync(cacheFilePath)
  ? JSON.parse(fs.readFileSync(cacheFilePath, "utf-8"))
  : {};

const publishingAssetIds = new Set<string>();
if (fs.existsSync(publishingAssetIdsPath)) {
  const parsed = JSON.parse(fs.readFileSync(publishingAssetIdsPath, "utf-8"));
  if (Array.isArray(parsed)) {
    parsed.forEach(id => publishingAssetIds.add(String(id).trim()));
  }
}

// Mimic cache load neighboring/publishing assets
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

async function run() {
  const yearMonth = "202604";
  const systemManagedDir = path.resolve(process.cwd(), "reports/system-managed");

  console.log(`Cache Loaded: ${Object.keys(metadataCache).length} assets`);
  console.log(`Publishing Asset IDs in JSON: ${publishingAssetIds.size}`);
  console.log(`Neighboring Assets set size: ${neighboringAssetsFromCache.size}`);
  console.log(`Publishing Assets set size: ${publishingAssetsFromCache.size}`);

  // 1. Ads Revenue raw files
  const adFiles = listMonthlySystemManagedFiles(systemManagedDir, yearMonth, "content_owner_asset_ad_revenue_raw_a1");
  const adFinancialMap = await parsePublishingFinancialFiles(adFiles);

  let adTotal = 0;
  let adPubTotal = 0;
  let adNeighTotal = 0;
  let adUnknownTotal = 0;

  for (const entry of adFinancialMap.values()) {
    const rev = entry.partnerTotalRevenue;
    adTotal += rev;
    if (isPublishingRecord(entry.assetId)) {
      adPubTotal += rev;
    } else if (isNeighboringRecord(entry.assetId)) {
      adNeighTotal += rev;
    } else {
      adUnknownTotal += rev;
    }
  }

  // 2. Ads Adjustment raw files
  const adjFiles = listMonthlySystemManagedFiles(systemManagedDir, yearMonth, "content_owner_asset_ad_adjustment_revenue_raw_a1");
  let adjTotal = 0;
  let adjPubTotal = 0;
  let adjNeighTotal = 0;
  let adjUnknownTotal = 0;

  if (adjFiles.length > 0) {
    const adjFinancialMap = await parsePublishingFinancialFiles(adjFiles);
    for (const entry of adjFinancialMap.values()) {
      const rev = entry.partnerTotalRevenue;
      adjTotal += rev;
      if (isPublishingRecord(entry.assetId)) {
        adjPubTotal += rev;
      } else if (isNeighboringRecord(entry.assetId)) {
        adjNeighTotal += rev;
      } else {
        adjUnknownTotal += rev;
      }
    }
  }

  // 3. Subscriptions (Red) raw files
  const redFiles = listMonthlySystemManagedFiles(systemManagedDir, yearMonth, "music_content_owner_asset_red_revenue_raw_a1");
  const redMap = await parseRedSummaryFiles(redFiles);

  let redTotal = 0;
  let redPubTotal = 0;
  let redNeighTotal = 0;
  let redUnknownTotal = 0;

  let redAdjTotal = 0;
  let redAdjPubTotal = 0;
  let redAdjNeighTotal = 0;
  let redAdjUnknownTotal = 0;

  for (const entry of redMap.values()) {
    const rev = entry.partnerRevenue;
    if (entry.adjustmentType === "None") {
      redTotal += rev;
      if (isPublishingRecord(entry.assetId)) {
        redPubTotal += rev;
      } else if (isNeighboringRecord(entry.assetId)) {
        redNeighTotal += rev;
      } else {
        redUnknownTotal += rev;
      }
    } else {
      redAdjTotal += rev;
      if (isPublishingRecord(entry.assetId)) {
        redAdjPubTotal += rev;
      } else if (isNeighboringRecord(entry.assetId)) {
        redAdjNeighTotal += rev;
      } else {
        redAdjUnknownTotal += rev;
      }
    }
  }

  // 4. Audio Tier Detail
  const audioTierFiles = listMonthlySystemManagedFiles(systemManagedDir, yearMonth, "content_owner_claim_audio_tier_revenue_raw_a1");
  const audioDetails = await parseAudioTierDetailFiles(audioTierFiles);
  let audioTotal = 0;
  let audioPubTotal = 0;
  let audioNeighTotal = 0;
  let audioUnknownTotal = 0;

  for (const entry of audioDetails) {
    const rev = entry.partnerRevenue;
    audioTotal += rev;
    if (isPublishingRecord(entry.assetId)) {
      audioPubTotal += rev;
    } else if (isNeighboringRecord(entry.assetId)) {
      audioNeighTotal += rev;
    } else {
      audioUnknownTotal += rev;
    }
  }

  console.log("\n================ REPORT ANALYSIS (CACHE ONLY) ================");
  console.log(`Year Month: ${yearMonth}`);
  
  console.log("\n[Ads Revenue]");
  console.log(`- Raw Total Partner Revenue: ${adTotal}`);
  console.log(`- Classified as Publishing (저작): ${adPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${adNeighTotal}`);
  console.log(`- Classified as Unknown (미분류): ${adUnknownTotal}`);

  console.log("\n[Ads Adjustment]");
  console.log(`- Raw Total Partner Revenue: ${adjTotal}`);
  console.log(`- Classified as Publishing (저작): ${adjPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${adjNeighTotal}`);
  console.log(`- Classified as Unknown (미분류): ${adjUnknownTotal}`);

  console.log("\n[Subscriptions (Red) Revenue]");
  console.log(`- Raw Total (No Adjustment): ${redTotal}`);
  console.log(`- Classified as Publishing (저작): ${redPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${redNeighTotal}`);
  console.log(`- Classified as Unknown (미분류): ${redUnknownTotal}`);
  console.log(`- Raw Total (With Adjustment): ${redAdjTotal}`);
  console.log(`- Classified as Publishing (저작): ${redAdjPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${redAdjNeighTotal}`);
  console.log(`- Classified as Unknown (미분류): ${redAdjUnknownTotal}`);

  console.log("\n[Audio Tier Revenue]");
  console.log(`- Raw Total: ${audioTotal}`);
  console.log(`- Classified as Publishing (저작): ${audioPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${audioNeighTotal}`);
  console.log(`- Classified as Unknown (미분류): ${audioUnknownTotal}`);
}

run().catch(console.error);
