import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import * as fs from "fs";

async function listReportTypes() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  const CMS_ID = "2jFu0i9K0PE3MDrkU_UUfQ"; // 현재 찾으신 ID

  const log = [];
  log.push(`== CMS ID [${CMS_ID}] 기반 리포트 타입 조회 ==`);
  try {
    const res = await youtubereporting.reportTypes.list({
      onBehalfOfContentOwner: CMS_ID
    });
    const types = res.data.reportTypes || [];
    log.push(`CMS 리포트: ${types.length}개 발견`);
    types.forEach(t => log.push(` - ${t.id} (${t.name})`));
  } catch (err: any) {
    log.push(`CMS 리포트 조회 실패: ${err.message}`);
    if (err.response) {
      log.push(`상태 코드: ${err.response.status}`);
      log.push(`에러 데이터: ${JSON.stringify(err.response.data)}`);
    }
  }

  fs.writeFileSync("report_types_cms.log", log.join("\n"), "utf-8");
  console.log("CMS 전용 리포트 목록이 report_types_cms.log 파일에 저장되었습니다.");
}

listReportTypes().catch(console.error);
