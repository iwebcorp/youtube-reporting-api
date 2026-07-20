import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

async function downloadAllMarchReports() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  console.log(`[Reporting] 3월 수익 리포트 다운로드를 시작합니다...`);

  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

  // 1. Job 목록 확인
  const jobsRes = await youtubereporting.jobs.list({ onBehalfOfContentOwner: cfg.contentOwnerId });
  const jobs = jobsRes.data.jobs || [];
  
  for (const job of jobs) {
    if (job.reportTypeId !== "content_owner_asset_estimated_revenue_a1") continue;

    console.log(`- Job [${job.id}]에서 리포트 목록을 가져오는 중...`);
    const reportsRes = await youtubereporting.jobs.reports.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
      jobId: job.id,
    });

    const reports = reportsRes.data.reports || [];
    const marchReports = reports.filter(r => r.startTime && r.startTime.startsWith("2026-03"));

    console.log(`- 총 ${marchReports.length}개의 3월 리포트를 발견했습니다.`);

    for (const report of marchReports) {
      const fileName = `report_${report.startTime?.split('T')[0]}_${report.id}.csv`;
      const filePath = path.join(reportsDir, fileName);

      if (fs.existsSync(filePath)) {
          console.log(`  > [건너뜀] ${fileName} (이미 존재)`);
          continue;
      }

      console.log(`  > [다운로드 중] ${fileName}...`);
      
      const response = await auth.request<any>({
        url: report.downloadUrl,
        responseType: "stream",
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    }
  }

  console.log("[Reporting] ✅ 모든 3월 수익 리포트 다운로드 완료!");
}

downloadAllMarchReports().catch(console.error);
