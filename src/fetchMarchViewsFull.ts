import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

interface GranularUsage {
  total: number;
  watchPage: number;
  embedded: number;
  channelPage: number;
  live: number;
  onDemand: number;
  adEnabled: number;
}

async function getActiveAssetIds(): Promise<string[]> {
  console.log("[ViewsFull] 3월 원천 데이터에서 액티브 자산 식별 중...");
  const assetSet = new Set<string>();
  const reportDir = path.join(process.cwd(), "reports");
  const files = fs.readdirSync(reportDir).filter(f => f.startsWith("report_2026-03-") && f.endsWith(".csv"));

  for (const f of files) {
    const filePath = path.join(reportDir, f);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let assetIdx = -1;

    for (const [i, line] of lines.entries()) {
      if (i === 0) {
        assetIdx = line.split(",").map(c => c.trim().toLowerCase()).indexOf("asset_id");
        continue;
      }
      const aid = line.split(",")[assetIdx];
      if (aid && aid.startsWith("A")) assetSet.add(aid);
    }
  }
  return Array.from(assetSet);
}

async function fetchDataForBatch(analytics: any, batch: string[], usageData: Record<string, GranularUsage>) {
  try {
    // Pass A: Location
    const resA = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: cfg.startDate,
      endDate: cfg.endDate,
      metrics: "views,monetizedPlaybacks",
      dimensions: "asset,insightPlaybackLocationType",
      filters: `asset==${batch.join(",")}`,
    });

    if (resA.data.rows) {
      resA.data.rows.forEach(([aid, loc, views, adViews]: any) => {
        const u = usageData[aid];
        if (!u) return;
        const v = parseInt(views);
        const av = parseInt(adViews);
        u.total += v;
        u.adEnabled += av;
        if (loc === "WATCH_PAGE" || loc === "WATCH") u.watchPage += v;
        else if (loc === "EMBEDDED") u.embedded += v;
        else if (loc === "CHANNEL_PAGE" || loc === "BROWSE") u.channelPage += v;
      });
    }

    // Pass B: LiveStatus
    const resB = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: cfg.startDate,
      endDate: cfg.endDate,
      metrics: "views",
      dimensions: "asset,liveOrOnDemand",
      filters: `asset==${batch.join(",")}`,
    });

    if (resB.data.rows) {
      resB.data.rows.forEach(([aid, lod, views]: any) => {
        const u = usageData[aid];
        if (!u) return;
        const v = parseInt(views);
        if (lod === "LIVE") u.live += v;
        else if (lod === "ON_DEMAND") u.onDemand += v;
      });
    }
  } catch (err: any) {
    // 배치 실패 시 개별 시도
    if (batch.length > 1) {
      for (const aid of batch) {
        await fetchDataForBatch(analytics, [aid], usageData);
      }
    } else {
       // 개별 자산도 실패하는 경우 (API 미지원 자산)
       // console.warn(`  [!] Skipping Asset ${batch[0]}: ${err.message}`);
    }
  }
}

async function fetchFullData() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });
  const allAssetIds = await getActiveAssetIds();
  const usageData: Record<string, GranularUsage> = {};

  console.log(`[ViewsFull] 총 ${allAssetIds.length}개 자산 개별 보호 수집 시작...`);

  allAssetIds.forEach(aid => {
    usageData[aid] = { total: 0, watchPage: 0, embedded: 0, channelPage: 0, live: 0, onDemand: 0, adEnabled: 0 };
  });

  const batchSize = 10;
  const concurrency = 10;
  let processedCount = 0;

  for (let i = 0; i < allAssetIds.length; i += batchSize * concurrency) {
    const batches = [];
    for (let c = 0; c < concurrency; c++) {
      const start = i + (c * batchSize);
      if (start < allAssetIds.length) batches.push(allAssetIds.slice(start, start + batchSize));
    }

    await Promise.all(batches.map(b => fetchDataForBatch(analytics, b, usageData)));
    
    processedCount += batches.reduce((acc, b) => acc + b.length, 0);
    console.log(`[ViewsFull] 진행: ${processedCount} / ${allAssetIds.length} (${Math.round((processedCount/allAssetIds.length)*100)}%)`);
    await new Promise(r => setTimeout(r, 100));
  }

  // 보조 보정: total이 0인데 adEnabled가 있는 경우 등 체크 (생략 가능)
  
  const usageCachePath = path.join(process.cwd(), "usage_data_cache.json");
  fs.writeFileSync(usageCachePath, JSON.stringify(usageData, null, 2));
  console.log(`[ViewsFull] ✅ 전수 수집 완료!`);
}

fetchFullData().catch(console.error);
