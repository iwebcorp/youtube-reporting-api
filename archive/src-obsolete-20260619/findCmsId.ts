import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

async function findCmsId() {
  const auth = await getAuthClient();
  
  console.log("관리 중인 CMS(콘텐츠 소유자) 목록을 불러오는 중...");
  try {
    // youtubepartner 라이브러리 대신 직접 HTTP 요청을 보냅니다.
    const res = await auth.request<any>({
      url: "https://www.googleapis.com/youtube/partner/v1/contentOwners?fetchMine=true",
    });
    
    const owners = res.data.items;

    if (!owners || owners.length === 0) {
      console.log("\n이 계정에 연결된 CMS를 찾을 수 없거나 'YouTube Content ID API'가 비활성화되어 있습니다.");
      console.log("1. Google Cloud Console에서 'YouTube Content ID API'가 활성화되어 있는지 확인하세요.");
      console.log("2. 현재 로그인한 계정이 실제로 CMS 관리 권한이 있는지 확인하세요.");
      return;
    }

    console.log("\n=== 발견된 CMS 목록 ===");
    owners.forEach((owner: any) => {
      console.log(`- CMS 이름: ${owner.displayName}`);
      console.log(`  CMS ID (이걸 복사해서 소스코드에 넣으세요!!): ${owner.id}`);
    });
  } catch (error: any) {
    console.error("\n[조회 실패]");
    if (error.response) {
      console.error(`상태 코드: ${error.response.status}`);
      console.error(`메시지: ${error.response.data.error.message}`);
      if (error.response.status === 403) {
        console.log("\n[해결 방법]");
        console.log("1. GCP 콘솔에서 'YouTube Content ID API'를 검색해 활성화 하세요.");
        console.log("2. 만약 이미 활성화했다면, npx tsx src/reAuth.ts 를 실행해 권한을 갱신하세요.");
      }
    } else {
      console.error(error.message);
    }
  }
}

findCmsId().catch(console.error);
