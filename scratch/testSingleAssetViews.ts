import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function testSingleAsset() {
    const auth = await getAuthClient();
    const analytics = google.youtubeAnalytics({ version: "v2", auth });

    console.log("[Analytics] 단일 자산 조회 테스트 시작...");
    
    try {
        const res = await analytics.reports.query({
            ids: `contentOwner==${cfg.contentOwnerId}`,
            startDate: cfg.startDate,
            endDate: cfg.endDate,
            metrics: "views",
            dimensions: "asset",
            filters: "asset==A874461896561869;claimedStatus==claimed", // 특정 자산 ID 테스트
        });

        console.log("[Analytics] 성공!");
        console.log("결과:", JSON.stringify(res.data, null, 2));
    } catch (err: any) {
        console.error("[Analytics] 실패:", err.message);
        if (err.response) {
            console.error("에러 내용:", JSON.stringify(err.response.data, null, 2));
        }
    }
}

testSingleAsset().catch(console.error);
