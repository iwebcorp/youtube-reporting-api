import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

interface PublishingUsage {
  totalRevenue: number;
  adRevenue: number;
  subRevenue: number;
  totalViews: number;
  watchPageViews: number;
  embeddedViews: number;
  channelPageViews: number;
  liveViews: number;
  onDemandViews: number;
}

async function fetchPublishingBatch(analytics: any, batch: string[], cache: Record<string, PublishingUsage>) {
  try {
    // 1. Revenue & Total Views
    const resA = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: cfg.startDate,
      endDate: cfg.endDate,
      metrics: "estimatedRevenue,estimatedAdRevenue,views",
      dimensions: "asset",
      filters: `asset==${batch.join(",")}`,
    });

    if (resA.data.rows) {
      resA.data.rows.forEach(([aid, totalR, adR, views]: any) => {
        const u = cache[aid];
        if (!u) return;
        u.totalRevenue = parseFloat(totalR);
        u.adRevenue = parseFloat(adR);
        u.subRevenue = Math.max(0, u.totalRevenue - u.adRevenue);
        u.totalViews = parseInt(views);
      });
    }

    // 2. Playback Location (Granular Views)
    const resB = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: cfg.startDate,
      endDate: cfg.endDate,
      metrics: "views",
      dimensions: "asset,insightPlaybackLocationType",
      filters: `asset==${batch.join(",")}`,
    });

    if (resB.data.rows) {
      resB.data.rows.forEach(([aid, loc, views]: any) => {
        const u = cache[aid];
        if (!u) return;
        const v = parseInt(views);
        if (loc === "WATCH_PAGE" || loc === "WATCH") u.watchPageViews += v;
        else if (loc === "EMBEDDED") u.embeddedViews += v;
        else if (loc === "CHANNEL_PAGE" || loc === "BROWSE") u.channelPageViews += v;
      });
    }

    // 3. Live or OnDemand
    const resC = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: cfg.startDate,
      endDate: cfg.endDate,
      metrics: "views",
      dimensions: "asset,liveOrOnDemand",
      filters: `asset==${batch.join(",")}`,
    });

    if (resC.data.rows) {
      resC.data.rows.forEach(([aid, lod, views]: any) => {
        const u = cache[aid];
        if (!u) return;
        const v = parseInt(views);
        if (lod === "LIVE") u.liveViews += v;
        else if (lod === "ON_DEMAND") u.onDemandViews += v;
      });
    }

  } catch (err: any) {
    if (batch.length > 1) {
       for (const aid of batch) await fetchPublishingBatch(analytics, [aid], cache);
    }
  }
}

async function run() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });
  
  const ids = JSON.parse(fs.readFileSync(path.join(process.cwd(), "publishing_asset_ids.json"), "utf-8"));
  const cache: Record<string, PublishingUsage> = {};
  
  ids.forEach((aid: string) => {
    cache[aid] = { totalRevenue: 0, adRevenue: 0, subRevenue: 0, totalViews: 0, watchPageViews: 0, embeddedViews: 0, channelPageViews: 0, liveViews: 0, onDemandViews: 0 };
  });

  console.log(`[PubFetcher] 저작권 자산 ${ids.length}개 대상 수익/뷰 수집 시작...`);

  const batchSize = 10;
  const concurrency = 20;
  let processed = 0;

  for (let i = 0; i < ids.length; i += batchSize * concurrency) {
    const batches = [];
    for (let c = 0; c < concurrency; c++) {
      const s = i + (c * batchSize);
      if (s < ids.length) batches.push(ids.slice(s, s + batchSize));
    }
    await Promise.all(batches.map(b => fetchPublishingBatch(analytics, b, cache)));
    processed += batches.reduce((acc, b) => acc + b.length, 0);
    console.log(`  ... 진행: ${processed} / ${ids.length} (${Math.round((processed/ids.length)*100)}%)`);
  }

  fs.writeFileSync(path.join(process.cwd(), "publishing_usage_cache.json"), JSON.stringify(cache, null, 2));
  console.log("✅ [PubFetcher] 저작권 실데이터 수집 완료!");
}

run().catch(console.error);
