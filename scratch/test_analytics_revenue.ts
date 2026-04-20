import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function testRevenue() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });

  console.log("--- Testing Analytics Revenue Query (v2) ---");
  try {
    const testAsset = "A186227692025060"; 

    const res = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: cfg.startDate,
      endDate: cfg.endDate,
      metrics: "estimatedRevenue,estimatedAdRevenue,views",
      dimensions: "asset",
      filters: `asset==${testAsset}`,
    });

    console.log("Response Data:");
    if (res.data.rows && res.data.rows.length > 0) {
        console.log(JSON.stringify(res.data.rows, null, 2));
        console.log("✅ Success! Total and Ad revenue identified.");
    } else {
        console.log("⚠️ No data returned. Asset might have 0 revenue or not be accessible.");
    }
  } catch (err: any) {
    console.error(`❌ Analytics Revenue Error: ${err.message}`);
  }
}

testRevenue().catch(console.error);
