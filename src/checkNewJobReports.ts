import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";

const cfg = loadConfig();

async function checkNewJobReports() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  console.log("[Reporting] 새 Job [b4ae1d9d-c096-4d6b-9b82-7792f2e5f202]의 리포트 목록을 확인합니다...");

  try {
    const res = await reporting.jobs.reports.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
      jobId: "b4ae1d9d-c096-4d6b-9b82-7792f2e5f202",
    });

    const reports = res.data.reports || [];
    console.log(`- 발견된 리포트 수: ${reports.length}`);

    if (reports.length > 0) {
      const marchReports = reports.filter(r => r.startTime && r.startTime.startsWith("2026-03"));
      console.log(`- 그 중 3월 리포트 수: ${marchReports.length}`);
      marchReports.forEach(r => {
        console.log(`  > [${r.startTime?.split('T')[0]}] ID: ${r.id}`);
      });
    }
  } catch (err: any) {
    console.error("❌ 리포트 목록 조회 실패:", err.message);
  }
}

checkNewJobReports().catch(console.error);
