import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import * as fs from "fs";
import * as path from "path";

// --- 다운로드 설정 (원하는 기간을 설정하세요) ---
const START_DATE = "2026-01-13"; // 예: "2026-01-13" (이 시간 이후 시작된 리포트)
const END_DATE = "2026-02-27";   // 예: "2026-02-27" (이 시간 이전 시작된 리포트)
const CONTENT_OWNER_ID = "2jFu0i9K0PE3MDrkU_UUfQ"; // CMS ID

async function getReports() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  // 1. 현재 계정에 등록된 모든 Job 목록 가져오기
  const jobsRes = await youtubereporting.jobs.list({
    onBehalfOfContentOwner: CONTENT_OWNER_ID,
  });
  const jobs = jobsRes.data.jobs || [];

  if (jobs.length === 0) {
    console.log("등록된 Job이 없습니다. 먼저 Job을 생성해 주세요.");
    return;
  }

  console.log(`현재 총 ${jobs.length}개의 리포트 작업(Job)이 발견되었습니다.`);

  // 리포트 저장용 폴더 생성
  const reportDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }

  for (const job of jobs) {
    console.log(`\n[Job 처리 중] ${job.name} (${job.reportTypeId})...`);

    // 2. 해당 Job의 리포트 목록 가져오기 (날짜 필터 적용 가능할 경우 적용)
    const reportsRes = await youtubereporting.jobs.reports.list({
      onBehalfOfContentOwner: CONTENT_OWNER_ID,
      jobId: job.id!,
      // API 수준에서 필터링이 가능하면 여기에 추가 (startTimeAtOrAfter 등)
    });

    const reports = reportsRes.data.reports || [];
    
    // 3. 날짜 기준 필터링 및 다운로드
    const start = new Date(START_DATE);
    const end = new Date(END_DATE);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const filteredReports = reports.filter(r => {
      if (!r.startTime) return false;
      const reportDate = new Date(r.startTime);
      return reportDate >= start && reportDate <= end;
    });

    if (filteredReports.length === 0) {
      console.log(` - 해당 기간(${START_DATE} ~ ${END_DATE})에 생성된 리포트가 없습니다.`);
      continue;
    }

    console.log(` - 기간 내 발견된 ${filteredReports.length}개의 리포트를 다운로드합니다.`);

    for (const report of filteredReports) {
      const dateStr = report.startTime!.split("T")[0];
      const typeShort = job.reportTypeId?.replace("content_owner_", "").substring(0, 10);
      const fileName = `report_${dateStr}_${typeShort}_${report.id?.substring(0, 5)}.csv`;
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
