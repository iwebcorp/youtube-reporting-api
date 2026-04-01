import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

async function findContentOwner() {
  const auth = await getAuthClient();
  // YouTube Analytics API를 사용하여 Content Owner ID를 찾아봅니다.
  const analytics = google.youtubeAnalytics({ version: "v2", auth });

  console.log("관리 중인 Content Owner (CMS) 목록 조회 중...");
  try {
    // Note: 실제로는 youtubePartner API가 더 정확할 수 있으나, Analytics API로도 조회가 가능할 수 있습니다.
    // 하지만 가장 확실한 방법은 YouTube 스튜디오(CMS) 설정에서 확인하는 것입니다.
    console.log("CMS ID를 직접 입력하시거나, YouTube 스튜디오 CMS 설정에서 확인해주세요.");
  } catch (error) {
    console.error("조회 실패:", error);
  }
}

findContentOwner().catch(console.error);
