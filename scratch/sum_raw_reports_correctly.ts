import * as fs from "fs";
import * as path from "path";
import { AssetClassifier } from "../src/assetClassifier.js";
import { parsePublishingFinancialFiles, parseRedSummaryFiles, parseAudioTierDetailFiles } from "../src/reporting/parsers.js";
import { listMonthlySystemManagedFiles, loadPublishingUsageCache } from "../src/reporting/utils.js";

// copy isPublishingRecord from extractPublishingCsvs.ts
function loadPublishingAssetIds(): Set<string> {
  const filePath = path.resolve(process.cwd(), "publishing_asset_ids.json");
  if (!fs.existsSync(filePath)) {
    return new Set<string>();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }
    return new Set(parsed.map((value) => String(value).trim()).filter(Boolean));
  } catch (error) {
    return new Set<string>();
  }
}

function isPublishingRecord(classifier: AssetClassifier, publishingAssetIds: Set<string>, assetId: string): boolean {
  if (publishingAssetIds.has(assetId)) {
    return true;
  }
  const metadata = classifier.getMetadata(assetId);
  if (classifier.classify(assetId) === "Publishing") {
    return true;
  }
  if (!metadata.isrc && (metadata.writers !== "Unidentified Writers" || metadata.artist !== "Various Artists")) {
    return true;
  }
  return false;
}

async function run() {
  const yearMonth = "202604";
  const systemManagedDir = path.resolve(process.cwd(), "reports/system-managed");
  const cacheFile = path.resolve(process.cwd(), "asset_metadata_cache.json");
  const defaultCustomIdDir = `reports_custom_id_${yearMonth}`;
  const neighboringDir = path.resolve(process.cwd(), defaultCustomIdDir);
  const publishingDir = path.resolve(process.cwd(), defaultCustomIdDir);

  const classifier = new AssetClassifier();
  await classifier.initialize({
    neighboringDir,
    publishingDir,
    cacheFile,
  });

  const publishingAssetIds = loadPublishingAssetIds();

  // 1. Ads Revenue raw files
  const adFiles = listMonthlySystemManagedFiles(systemManagedDir, yearMonth, "content_owner_asset_ad_revenue_raw_a1");
  const adFinancialMap = await parsePublishingFinancialFiles(adFiles);

  let adTotal = 0;
  let adPubTotal = 0;
  let adNeighTotal = 0;

  for (const entry of adFinancialMap.values()) {
    const rev = entry.partnerTotalRevenue;
    adTotal += rev;
    if (isPublishingRecord(classifier, publishingAssetIds, entry.assetId)) {
      adPubTotal += rev;
    } else {
      adNeighTotal += rev;
    }
  }

  // 2. Ads Adjustment raw files
  const adjFiles = listMonthlySystemManagedFiles(systemManagedDir, yearMonth, "content_owner_asset_ad_adjustment_revenue_raw_a1");
  let adjTotal = 0;
  let adjPubTotal = 0;
  let adjNeighTotal = 0;
  if (adjFiles.length > 0) {
    // we can parse it as well. parsePublishingFinancialFiles works for adjustments too because it has similar schema?
    // Let's verify by parsing
    const adjFinancialMap = await parsePublishingFinancialFiles(adjFiles);
    for (const entry of adjFinancialMap.values()) {
      const rev = entry.partnerTotalRevenue;
      adjTotal += rev;
      if (isPublishingRecord(classifier, publishingAssetIds, entry.assetId)) {
        adjPubTotal += rev;
      } else {
        adjNeighTotal += rev;
      }
    }
  }

  // 3. Subscriptions (Red) raw files
  const redFiles = listMonthlySystemManagedFiles(systemManagedDir, yearMonth, "music_content_owner_asset_red_revenue_raw_a1");
  const redMap = await parseRedSummaryFiles(redFiles);

  let redTotal = 0;
  let redPubTotal = 0;
  let redNeighTotal = 0;

  let redAdjTotal = 0;
  let redAdjPubTotal = 0;
  let redAdjNeighTotal = 0;

  for (const entry of redMap.values()) {
    const rev = entry.partnerRevenue;
    if (entry.adjustmentType === "None") {
      redTotal += rev;
      if (isPublishingRecord(classifier, publishingAssetIds, entry.assetId)) {
        redPubTotal += rev;
      } else {
        redNeighTotal += rev;
      }
    } else {
      redAdjTotal += rev;
      if (isPublishingRecord(classifier, publishingAssetIds, entry.assetId)) {
        redAdjPubTotal += rev;
      } else {
        redAdjNeighTotal += rev;
      }
    }
  }

  // 4. Audio Tier Detail
  const audioTierFiles = listMonthlySystemManagedFiles(systemManagedDir, yearMonth, "content_owner_claim_audio_tier_revenue_raw_a1");
  const audioDetails = await parseAudioTierDetailFiles(audioTierFiles);
  let audioTotal = 0;
  let audioPubTotal = 0;
  let audioNeighTotal = 0;

  for (const entry of audioDetails) {
    const rev = entry.partnerRevenue;
    audioTotal += rev;
    if (isPublishingRecord(classifier, publishingAssetIds, entry.assetId)) {
      audioPubTotal += rev;
    } else {
      audioNeighTotal += rev;
    }
  }

  console.log("\n================ REPORT ANALYSIS ================");
  console.log(`Year Month: ${yearMonth}`);
  console.log(`Publishing Asset IDs in JSON: ${publishingAssetIds.size}`);
  
  console.log("\n[Ads Revenue]");
  console.log(`- Raw Total Partner Revenue: ${adTotal}`);
  console.log(`- Classified as Publishing (저작): ${adPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${adNeighTotal}`);

  console.log("\n[Ads Adjustment]");
  console.log(`- Raw Total Partner Revenue: ${adjTotal}`);
  console.log(`- Classified as Publishing (저작): ${adjPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${adjNeighTotal}`);

  console.log("\n[Subscriptions (Red) Revenue]");
  console.log(`- Raw Total (No Adjustment): ${redTotal}`);
  console.log(`- Classified as Publishing (저작): ${redPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${redNeighTotal}`);
  console.log(`- Raw Total (With Adjustment): ${redAdjTotal}`);
  console.log(`- Classified as Publishing (저작): ${redAdjPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${redAdjNeighTotal}`);

  console.log("\n[Audio Tier Revenue]");
  console.log(`- Raw Total: ${audioTotal}`);
  console.log(`- Classified as Publishing (저작): ${audioPubTotal}`);
  console.log(`- Classified as Neighboring (인접): ${audioNeighTotal}`);
  
  console.log("\n================ COMPARISON WITH CLIENT ================");
  console.log("Client Reported (HaveToFix.md):");
  console.log("- Ads Revenue (None): 23452.99078");
  console.log("- Ads Revenue (Conflict Resolution): 0.0011089");
  console.log("- Ads Revenue (Dispute Resolution): 6.065949344");
  console.log("- Subscriptions Revenue (None): 89920.62192");
  console.log("- Subscriptions Revenue (Conflict Resolution): 0.000244213");
  console.log("- Audio Tier Revenue (None): 40.60540276");
  console.log("- Shorts Revenue - Music Dynamic Pool (None): 568.6121594");
  console.log("- Total: 113988.8976");

  console.log("\nOur Package (reports_final_v20_202604_client_package):");
  console.log("- 1_publishing_daily_ad.csv sum: 4769.13");
  console.log("- 3_publishing_monthly_sub.csv sum: 50666.27");
  console.log("- 4_publishing_ddex_dsr.csv sum: [TBD]");
}

run().catch(console.error);
