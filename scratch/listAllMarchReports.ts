import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function listAllMarchReports() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  console.log(`[Reporting] 3월 전체 리포트 목록을 조회합니다 (onBehalfOfContentOwner: ${cfg.contentOwnerId})...`);

  // 1. 모든 Job 목록을 가져옵니다.
  const jobsRes = await youtubereporting.jobs.list({
    onBehalfOfContentOwner: cfg.contentOwnerId,
  });
  const jobs = jobsRes.data.jobs || [];
  console.log(`- 발견된 Job 수: ${jobs.length}`);

  for (const job of jobs) {
    console.log(`- Job [${job.id}] (${job.reportTypeId})의 리포트 조회 중...`);
    
    // 2. 각 Job에 대해 3월 리포트들을 나열합니다.
    const reportsRes = await youtubereporting.jobs.reports.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
      jobId: job.id,
      // startTimeAtOrAfter/Before 등으로 3월 필터링 (필요 시 전체 조회 후 필터링)
    });

    const reports = reportsRes.data.reports || [];
    const marchReports = reports.filter(r => 
        r.startTime && r.startTime.startsWith("2026-03")
    );

    console.log(`  > 3월 리포트 ${marchReports.length}개 발견`);
    marchReports.forEach(r => {
        console.log(`    [${r.id}] Start: ${r.startTime}, URL: ${r.downloadUrl ? '있음' : '없음'}`);
    });
  }
}

listAllMarchReports().catch(console.error);
