import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

async function fetchUsageFromAnalytics() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });

  console.log(`[Analytics] 국가별 분할 조회를 시작합니다 (${cfg.startDate} ~ ${cfg.endDate})...`);

  // 1. 먼저 데이터가 존재하는 국가 목록을 가져옵니다.
  console.log("[Analytics] 국가 목록 조회 중...");
  const countryRes = await analytics.reports.query({
    ids: `contentOwner==${cfg.contentOwnerId}`,
    startDate: cfg.startDate,
    endDate: cfg.endDate,
    metrics: "views",
    dimensions: "country",
    sort: "-views",
    maxResults: 200, 
  });

  const countryRows = countryRes.data.rows || [];
  const countries = countryRows.map(row => row[0]);
  console.log(`[Analytics] 총 ${countries.length}개 국가에서 조회수가 발생했습니다.`);

  // 2. 국가별로 루프를 돌며 자산별 조회수를 가져옵니다.
  const usageData: Record<string, Record<string, { views: number }>> = {};
  let totalRowsFetched = 0;

  for (const countryCode of countries) {
    let startIndex = 1;
    const maxResults = 10000;
    console.log(`[Analytics] 국가 쿼리 중: ${countryCode} (startIndex: ${startIndex})...`);

    try {
      while (true) {
        const res = await analytics.reports.query({
          ids: `contentOwner==${cfg.contentOwnerId}`,
          startDate: cfg.startDate,
          endDate: cfg.endDate,
          metrics: "views",
          dimensions: "asset",
          filters: `country==${countryCode};claimedStatus==claimed`,
          maxResults: maxResults,
          startIndex: startIndex,
        });

        const rows = res.data.rows || [];
        if (rows.length === 0) break;

        for (const [assetId, views] of rows) {
          if (!usageData[assetId]) {
            usageData[assetId] = {};
          }
          usageData[assetId][countryCode.toUpperCase()] = { views: Number(views) };
        }

        totalRowsFetched += rows.length;
        if (rows.length < maxResults) break;
        startIndex += maxResults;
      }
    } catch (err: any) {
      console.warn(`[Analytics] ${countryCode} 데이터 조회 실패 (건너뜀): ${err.message}`);
    }
  }

  const cachePath = path.join(process.cwd(), "usage_data_cache.json");
  fs.writeFileSync(cachePath, JSON.stringify(usageData, null, 2));
  console.log(`[Analytics] ✅ 최종 수집 완료! 총 ${totalRowsFetched}개 데이터 행 캐시됨.`);
}

fetchUsageFromAnalytics().catch(console.error);
