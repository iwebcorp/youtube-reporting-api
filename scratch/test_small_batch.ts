import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function testSmallBatch() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });

  // 3월 리포트에서 실제 자산 ID 2개만 가져옴 (예시)
  const testAssets = ["A186227692025060", "A705743674479125"]; 

  console.log(`--- Testing Small Batch (${testAssets.join(",")}) ---`);
  try {
    const res = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      metrics: "views",
      dimensions: "asset,insightPlaybackLocationType",
      filters: `asset==${testAssets.join(",")}`,
    });
    console.log(`✅ Success! Rows: ${res.data.rows?.length || 0}`);
    if (res.data.rows) console.log(res.data.rows.slice(0, 5));
  } catch (err: any) {
    console.error(`❌ Failed: ${err.message}`);
  }
}

testSmallBatch().catch(console.error);
