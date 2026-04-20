import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

async function batchTest() {
    const auth = await getAuthClient();
    const analytics = google.youtubeAnalytics({ version: "v2", auth });

    // 1. 수익이 실존하는 자산 리스트 로드 (아까 만든 스크립트 결과 활용 가능)
    // 여기서는 테스트를 위해 상위 몇 개만 추출
    const cacheFile = path.join(process.cwd(), "asset_metadata_cache.json");
    const assets = Object.keys(JSON.parse(fs.readFileSync(cacheFile, "utf-8"))).slice(0, 100);

    console.log(`[Batch Test] ${assets.length}개 자산에 대해 필터 쿼리를 시도합니다...`);
    
    try {
        const res = await analytics.reports.query({
            ids: `contentOwner==${cfg.contentOwnerId}`,
            startDate: cfg.startDate,
            endDate: cfg.endDate,
            metrics: "views",
            dimensions: "asset",
            filters: `asset==${assets.join(",")};claimedStatus==claimed`,
        });

        console.log("[Batch Test] ✅ 성공! 데이터가 반환되었습니다.");
        console.log(`- 결과 행 수: ${res.data.rows?.length || 0}`);
    } catch (err: any) {
        console.error("[Batch Test] ❌ 실패:", err.message);
    }
}

batchTest().catch(console.error);
