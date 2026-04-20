import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function test() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });

  const tests = [
    { name: "Total Views (asset)", metrics: "views", dimensions: "asset", filters: "" },
    { name: "Total Views with Claim Filter (asset)", metrics: "views", dimensions: "asset", filters: "claimedStatus==claimed;uploaderType==self" },
    { name: "Monetized Playbacks (asset)", metrics: "monetizedPlaybacks", dimensions: "asset", filters: "claimedStatus==claimed;uploaderType==self" },
    { name: "Playback Location (asset)", metrics: "views", dimensions: "asset,insightPlaybackLocationType", filters: "claimedStatus==claimed;uploaderType==self" },
    { name: "Live status (asset)", metrics: "views", dimensions: "asset,liveOrOnDemand", filters: "claimedStatus==claimed;uploaderType==self" },
  ];

  for (const t of tests) {
    console.log(`--- Testing: ${t.name} ---`);
    try {
      const res = await analytics.reports.query({
        ids: `contentOwner==${cfg.contentOwnerId}`,
        startDate: "2026-03-01",
        endDate: "2026-03-01",
        metrics: t.metrics,
        dimensions: t.dimensions,
        filters: t.filters || undefined,
      });
      console.log(`✅ Success! Rows: ${res.data.rows?.length || 0}`);
    } catch (err: any) {
      console.error(`❌ Failed: ${err.message}`);
    }
  }
}

test().catch(console.error);
