import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function testSingleAsset() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });

  console.log("[Analytics Test] 단일 자산(A186227692025060)의 3월 1일 조회수를 조회합니다...");

  try {
    const res = await analytics.reports.query({
      ids: `contentOwner==${cfg.contentOwnerId}`,
      startDate: "2026-03-01",
      endDate: "2026-03-01",
      metrics: "views",
      dimensions: "asset",
      filters: "asset==A186227692025060",
    });

    console.log("✅ 성공! API가 응답했습니다.");
    console.log("상세 결과:", JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error("❌ 실패:", err.message);
  }
}

testSingleAsset().catch(console.error);
