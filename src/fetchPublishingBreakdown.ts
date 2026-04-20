import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import { AssetClassifier } from "./assetClassifier.js";
import type { PublishingUsageCacheEntry } from "./reporting/types.js";

const cfg = loadConfig();

function createEmptyEntry(): PublishingUsageCacheEntry {
  return {
    totalRevenue: 0,
    adRevenue: 0,
    subRevenue: 0,
    totalViews: 0,
    watchPageViews: 0,
    embeddedViews: 0,
    channelPageViews: 0,
    liveViews: 0,
    onDemandViews: 0,
    adEnabledViews: 0,
    adsenseRevenue: 0,
    doubleclickServedYouTubeSoldRevenue: 0,
    doubleclickServedPartnerSoldRevenue: 0,
    partnerServedPartnerSoldRevenue: 0,
  };
}

async function collectPublishingAssetIds(): Promise<string[]> {
  const classifier = new AssetClassifier();
  await classifier.initialize({
    neighboringDir: path.resolve(process.cwd(), "인접"),
    publishingDir: path.resolve(process.cwd(), "저작"),
    cacheFile: path.resolve(process.cwd(), cfg.cacheFile),
  });

  const reportDir = path.resolve(process.cwd(), cfg.reportDir);
  const assetIds = new Set<string>();
  const isPublishingCandidate = (assetId: string): boolean => {
    const metadata = classifier.getMetadata(assetId);
    if (classifier.classify(assetId) === "Publishing") {
      return true;
    }
    return !metadata.isrc && (metadata.writers !== "Unidentified Writers" || metadata.artist !== "Various Artists");
  };

  for (const fileName of fs.readdirSync(reportDir)) {
    if (!fileName.endsWith(".csv")) continue;
    if (!fileName.includes(cfg.startDate.slice(0, 7))) continue;
    const filePath = path.join(reportDir, fileName);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const header = lines[0]?.split(",") ?? [];
    const assetIndex = header.findIndex((column) => column.trim().toLowerCase() === "asset_id");
    if (assetIndex < 0) continue;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const assetId = line.split(",")[assetIndex]?.trim();
      if (!assetId) continue;
      if (isPublishingCandidate(assetId)) {
        assetIds.add(assetId);
      }
    }
  }
  return Array.from(assetIds);
}

async function fetchViewsByLocation(
  analytics: ReturnType<typeof google.youtubeAnalytics>,
  assetIds: string[],
  cache: Record<string, PublishingUsageCacheEntry>,
): Promise<void> {
  const response = await analytics.reports.query({
    ids: `contentOwner==${cfg.contentOwnerId}`,
    startDate: cfg.startDate,
    endDate: cfg.endDate,
    metrics: "views,monetizedPlaybacks",
    dimensions: "asset,insightPlaybackLocationType",
    filters: `asset==${assetIds.join(",")}`,
  });

  for (const row of response.data.rows ?? []) {
    const [assetId, location, viewsRaw, monetizedRaw] = row as [string, string, string, string];
    const entry = cache[assetId] ?? createEmptyEntry();
    const views = Number(viewsRaw) || 0;
    const monetized = Number(monetizedRaw) || 0;
    entry.totalViews += views;
    entry.adEnabledViews += monetized;
    if (location === "WATCH_PAGE" || location === "WATCH") entry.watchPageViews += views;
    else if (location === "EMBEDDED") entry.embeddedViews += views;
    else if (location === "CHANNEL_PAGE" || location === "BROWSE") entry.channelPageViews += views;
    cache[assetId] = entry;
  }
}

async function fetchViewsByLiveStatus(
  analytics: ReturnType<typeof google.youtubeAnalytics>,
  assetIds: string[],
  cache: Record<string, PublishingUsageCacheEntry>,
): Promise<void> {
  const response = await analytics.reports.query({
    ids: `contentOwner==${cfg.contentOwnerId}`,
    startDate: cfg.startDate,
    endDate: cfg.endDate,
    metrics: "views",
    dimensions: "asset,liveOrOnDemand",
    filters: `asset==${assetIds.join(",")}`,
  });

  for (const row of response.data.rows ?? []) {
    const [assetId, liveOrOnDemand, viewsRaw] = row as [string, string, string];
    const entry = cache[assetId] ?? createEmptyEntry();
    const views = Number(viewsRaw) || 0;
    if (liveOrOnDemand === "LIVE") entry.liveViews += views;
    else if (liveOrOnDemand === "ON_DEMAND") entry.onDemandViews += views;
    cache[assetId] = entry;
  }
}

async function fetchRevenueTotals(
  analytics: ReturnType<typeof google.youtubeAnalytics>,
  assetIds: string[],
  cache: Record<string, PublishingUsageCacheEntry>,
): Promise<void> {
  const response = await analytics.reports.query({
    ids: `contentOwner==${cfg.contentOwnerId}`,
    startDate: cfg.startDate,
    endDate: cfg.endDate,
    metrics: "estimatedRevenue,estimatedAdRevenue,views",
    dimensions: "asset",
    filters: `asset==${assetIds.join(",")}`,
  });

  for (const row of response.data.rows ?? []) {
    const [assetId, totalRevenueRaw, adRevenueRaw, viewsRaw] = row as [string, string, string, string];
    const entry = cache[assetId] ?? createEmptyEntry();
    entry.totalRevenue = Number(totalRevenueRaw) || 0;
    entry.adRevenue = Number(adRevenueRaw) || 0;
    entry.subRevenue = Math.max(0, entry.totalRevenue - entry.adRevenue);
    if (entry.totalViews === 0) {
      entry.totalViews = Number(viewsRaw) || 0;
    }
    cache[assetId] = entry;
  }
}

async function run(): Promise<void> {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });
  const assetIds = await collectPublishingAssetIds();
  const cachePath = path.resolve(process.cwd(), "publishing_usage_cache.json");
  const cache: Record<string, PublishingUsageCacheEntry> = {};

  console.log(`[PublishingBreakdown] Fetching granular cache for ${assetIds.length} publishing assets.`);

  const batchSize = 25;
  for (let index = 0; index < assetIds.length; index += batchSize) {
    const batch = assetIds.slice(index, index + batchSize);
    batch.forEach((assetId) => {
      cache[assetId] = cache[assetId] ?? createEmptyEntry();
    });

    try {
      await fetchRevenueTotals(analytics, batch, cache);
      await fetchViewsByLocation(analytics, batch, cache);
      await fetchViewsByLiveStatus(analytics, batch, cache);
      console.log(`[PublishingBreakdown] Progress ${Math.min(index + batch.length, assetIds.length)} / ${assetIds.length}`);
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
    } catch (error) {
      console.error(`[PublishingBreakdown] Batch failed at index ${index}.`, error);
    }
  }

  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`[PublishingBreakdown] Saved granular cache to ${cachePath}`);
}

run().catch((error) => {
  console.error("[PublishingBreakdown] Failed.", error);
  process.exitCode = 1;
});
