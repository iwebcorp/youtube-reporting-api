import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

async function getReports() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  // 1. 현재 계정에 등록된 모든 Job 목록 가져오기
  const jobsRes = await youtubereporting.jobs.list({
    onBehalfOfContentOwner: cfg.contentOwnerId,
  });
  const jobs = jobsRes.data.jobs || [];

  if (jobs.length === 0) {
    console.log("등록된 Job이 없습니다. 먼저 Job을 생성해 주세요.");
    return;
  }

  console.log(`현재 총 ${jobs.length}개의 리포트 작업(Job)이 발견되었습니다.`);

  // 리포트 저장용 폴더 생성
  const reportDir = path.join(process.cwd(), cfg.reportDir);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }

  for (const job of jobs) {
    console.log(`\n[Job 처리 중] ${job.name} (${job.reportTypeId})...`);

    // 2. 해당 Job의 리포트 목록 가져오기
    const reportsRes = await youtubereporting.jobs.reports.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
      jobId: job.id!,
    });

    const reports = reportsRes.data.reports || [];
    
    // 3. 날짜 기준 필터링 및 다운로드 (config 기반)
    const start = new Date(cfg.startDate);
    const end = new Date(cfg.endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const filteredReports = reports.filter(r => {
      if (!r.startTime) return false;
      const reportDate = new Date(r.startTime);
      return reportDate >= start && reportDate <= end;
    });

    if (filteredReports.length === 0) {
      console.log(` - 해당 기간(${cfg.startDate} ~ ${cfg.endDate})에 생성된 리포트가 없습니다.`);
      continue;
    }

    console.log(` - 기간 내 발견된 ${filteredReports.length}개의 리포트를 다운로드합니다.`);

    for (const report of filteredReports) {
      const dateStr = report.startTime!.split("T")[0];
      const reportType = job.reportTypeId || "unknown";
      const fileName = `report_${dateStr}_${reportType}.csv`;
      const filePath = path.join(reportDir, fileName);

      if (fs.existsSync(filePath)) {
        console.log(`   [건너뜀] ${fileName}`);
        continue;
      }

      console.log(`   [다운로드] ${fileName}...`);
      const response = await auth.request<any>({
        url: report.downloadUrl!,
        responseType: "stream",
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      await new Promise((resolve) => writer.on("finish", resolve));
    }
  }

  console.log("\n✅ 모든 리포트 다운로드가 완료되었습니다!");
}

getReports().catch(console.error);
