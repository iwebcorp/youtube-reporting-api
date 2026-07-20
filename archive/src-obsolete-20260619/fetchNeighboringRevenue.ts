import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

interface UsageData {
  totalRevenue: number;
  adRevenue: number;
  subRevenue: number;
  totalViews: number;
}

async function fetchRevenueBatch(analytics: any, batch: string[], cache: Record<string, UsageData>) {
  try {
    const res = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: cfg.startDate,
      endDate: cfg.endDate,
      metrics: "estimatedRevenue,estimatedAdRevenue,views",
      dimensions: "asset",
      filters: `asset==${batch.join(",")}`,
    });

    if (res.data.rows) {
      res.data.rows.forEach(([aid, totalR, adR, views]: any) => {
        cache[aid] = {
            totalRevenue: parseFloat(totalR),
            adRevenue: parseFloat(adR),
            subRevenue: Math.max(0, parseFloat(totalR) - parseFloat(adR)),
            totalViews: parseInt(views)
        };
      });
    }
  } catch (err: any) {
    if (batch.length > 1) {
       for (const aid of batch) await fetchRevenueBatch(analytics, [aid], cache);
    }
  }
}

async function run() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });
  
  // Get all neighboring asset IDs from usage_data_cache.json (already collected views)
  const existingCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "usage_data_cache.json"), "utf-8"));
  const ids = Object.keys(existingCache);
  const revCache: Record<string, UsageData> = {};

  console.log(`[RevFetcher-Neb] 인접권 자산 ${ids.length}개 대상 수익 수집 시작...`);

  const batchSize = 10;
  const concurrency = 20;
  let processed = 0;

  for (let i = 0; i < ids.length; i += batchSize * concurrency) {
    const batches = [];
    for (let c = 0; c < concurrency; c++) {
      const s = i + (c * batchSize);
      if (s < ids.length) batches.push(ids.slice(s, s + batchSize));
    }
    await Promise.all(batches.map(b => fetchRevenueBatch(analytics, b, revCache)));
    processed += batches.reduce((acc, b) => acc + b.length, 0);
    console.log(`  ... 진행: ${processed} / ${ids.length} (${Math.round((processed/ids.length)*100)}%)`);
  }

  fs.writeFileSync(path.join(process.cwd(), "neighboring_revenue_cache.json"), JSON.stringify(revCache, null, 2));
  console.log("✅ [RevFetcher-Neb] 인접권 정산 데이터 수집 완료!");
}

run().catch(console.error);
