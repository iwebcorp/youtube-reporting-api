import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import * as fs from "fs";
import * as path from "path";

const JOB_ID = "80be075c-4239-4943-b42f-59d22c34128c";

async function getReports() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  const res = await youtubereporting.jobs.reports.list({
    onBehalfOfContentOwner: "2jFu0i9K0PE3MDrkU_UUfQ", // 콘텐츠 소유자 ID
    jobId: JOB_ID,
  });

  const reports = res.data.reports || [];

  if (reports.length === 0) {
    console.log("아직 리포트가 없어요. 유투브가 생성할 때까지 1~2일 정도 기다려주세요.");
    return;
  }

  console.log(`총 ${reports.length}개의 리포트 발견! 정산 데이터를 수집합니다...`);

  // 리포트 폴더 생성 (없으면 만들기)
  const reportDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }

  for (const report of reports) {
    if (!report.downloadUrl || !report.startTime) continue;

    // 날짜 형식 포맷팅 (예: 2026-03-31)
    const dateStr = report.startTime.split("T")[0];
    const fileName = `report_${dateStr}_${report.id?.substring(0, 8)}.csv`;
    const filePath = path.join(reportDir, fileName);

    // 이미 받은 파일이면 건너뜁니다.
    if (fs.existsSync(filePath)) {
      console.log(`[건너뜀] ${fileName} (이미 존재함)`);
      continue;
    }

    console.log(`[다운로드 중] ${fileName}...`);
    
    const response = await auth.request<any>({
      url: report.downloadUrl,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise((resolve) => writer.on("finish", resolve));
    console.log(`[완료] ${fileName} 저장됨.`);
  }

  console.log(`\n모든 리포트 확인 완료! (경로: ${reportDir})`);
}

getReports().catch(console.error);
