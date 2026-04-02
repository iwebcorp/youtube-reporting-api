import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

async function listReports() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  const res = await youtubereporting.jobs.reports.list({
    onBehalfOfContentOwner: "2jFu0i9K0PE3MDrkU_UUfQ", // CMS ID
    jobId: "80be075c-4239-4943-b42f-59d22c34128c" // Job ID
  });

  const reports = res.data.reports || [];
  if (reports.length === 0) {
    console.log("이 Job에 대한 리포트가 아직 하나도 생성되지 않았습니다.");
    console.log("보통 Job 생성 후 첫 리포트가 나오기까지 48시간 이상 걸릴 수 있습니다.");
  } else {
    console.log(`${reports.length}개의 리포트가 발견되었습니다!`);
    reports.forEach((report) => {
      console.log(`- [ID: ${report.id}] Start: ${report.startTime}, End: ${report.endTime}`);
    });
  }
}

listReports().catch(console.error);
