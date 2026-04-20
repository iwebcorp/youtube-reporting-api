import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function listMarchReports() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  console.log("--- Listing Published Reports for March 2026 ---");
  try {
    // 3월에 발행된 리포트 리스트 조회
    // 3월 데이터는 보통 4월 초까지 발행되므로 범위를 넉넉하게 잡습니다.
    const res = await reporting.reports.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
      startTimeAtOrAfter: "2026-03-01T00:00:00Z",
    });
    
    if (res.data.reports) {
      console.log(`Found ${res.data.reports.length} reports.`);
      const typesOfInterest = [
        "content_owner_playback_location_a3",
        "content_owner_asset_video_relationship_a1",
        "content_owner_asset_estimated_revenue_a1"
      ];

      res.data.reports.forEach(report => {
        if (typesOfInterest.includes(report.reportTypeId!)) {
          console.log(`- Type: ${report.reportTypeId} | Time: ${report.startTime} | ID: ${report.id} | DownloadURL: ${report.downloadUrl}`);
        }
      });
    } else {
      console.log("No published reports found.");
    }
  } catch (err: any) {
    console.error(`❌ Failed to list reports: ${err.message}`);
  }
}

listMarchReports().catch(console.error);
