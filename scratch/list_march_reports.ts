import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function listReports() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  console.log("--- Listing Published Reports for March 2026 ---");
  try {
    // 3월에 생성된 리포트 리스트 조회
    const res = await reporting.reports.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
      startTimeAtOrAfter: "2026-03-01T00:00:00Z",
    });
    
    if (res.data.reports) {
      console.log(`Found ${res.data.reports.length} reports.`);
      res.data.reports.slice(0, 20).forEach(report => {
        console.log(`- Report: ${report.reportTypeId} (Time: ${report.startTime}), ID: ${report.id}`);
      });
    } else {
      console.log("No published reports found.");
    }
  } catch (err: any) {
    console.error(`❌ Failed to list reports: ${err.message}`);
  }
}

listReports().catch(console.error);
