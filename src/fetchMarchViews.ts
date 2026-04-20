import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

interface GranularUsage {
  total: number;
  watchPage: number;
  embedded: number;
  channelPage: number;
  live: number;
  onDemand: number;
  adEnabled: number;
}

async function fetchMarchViews() {
  const auth = await getAuthClient();
  const analytics = google.youtubeAnalytics({ version: "v2", auth });
  const usageData: Record<string, GranularUsage> = {};

  const baseParams = {
    ids: `contentOwner==${cfg.contentOwnerId}`,
    startDate: cfg.startDate,
    endDate: cfg.endDate,
    filters: "claimedStatus==claimed;uploaderType==self", // 모든 소유 자산 대상 벌크 필터
  };

  try {
    // PASS 1: 총 조회수 및 광고 조회수 벌크 수집
    console.log("[Views] PASS 1: 전체 자산 총계 및 수익 창출 조회수 벌크 수집 중...");
    const res1 = await analytics.reports.query({
      ...baseParams,
      metrics: "views,monetizedPlaybacks",
      dimensions: "asset",
    });

    if (res1.data.rows) {
      res1.data.rows.forEach(([aid, views, adViews]) => {
        const id = aid as string;
        usageData[id] = {
          total: parseInt(views as string),
          adEnabled: parseInt(adViews as string),
          watchPage: 0, embedded: 0, channelPage: 0, live: 0, onDemand: 0
        };
      });
      console.log(`[Views] PASS 1 완료: ${res1.data.rows.length}개 활성 자산 식별.`);
    }

    // PASS 2: 재생 위치별 조회수 벌크 수집
    console.log("[Views] PASS 2: 전체 자산 재생 위치별 조회수 벌크 수집 중...");
    const res2 = await analytics.reports.query({
      ...baseParams,
      metrics: "views",
      dimensions: "asset,insightPlaybackLocationType",
    });

    if (res2.data.rows) {
      res2.data.rows.forEach(([aid, loc, views]) => {
        const id = aid as string;
        if (!usageData[id]) return;
        const v = parseInt(views as string);
        if (loc === "WATCH_PAGE") usageData[id].watchPage += v;
        else if (loc === "EMBEDDED") usageData[id].embedded += v;
        else if (loc === "CHANNEL_PAGE") usageData[id].channelPage += v;
      });
      console.log("[Views] PASS 2 완료.");
    }

    // PASS 3: 라이브 여부별 조회수 벌크 수집
    console.log("[Views] PASS 3: 전체 자산 라이브/VOD 조회수 벌크 수집 중...");
    const res3 = await analytics.reports.query({
      ...baseParams,
      metrics: "views",
      dimensions: "asset,liveOrOnDemand",
    });

    if (res3.data.rows) {
      res3.data.rows.forEach(([aid, lod, views]) => {
        const id = aid as string;
        if (!usageData[id]) return;
        const v = parseInt(views as string);
        if (lod === "LIVE") usageData[id].live += v;
        else if (lod === "ON_DEMAND") usageData[id].onDemand += v;
      });
      console.log("[Views] PASS 3 완료.");
    }

  } catch (err: any) {
    console.error("[Views] 수집 중 치명적 오류 발생:", err.message);
    if (err.message.includes("monetary")) {
        console.warn("⚠️ 경고: 수익 관련 권한(yt-analytics-monetary.readonly)이 부족할 수 있습니다.");
    }
  }

  const usageCachePath = path.join(process.cwd(), "usage_data_cache.json");
  fs.writeFileSync(usageCachePath, JSON.stringify(usageData, null, 2));
  console.log(`[Views] ✅ 고정밀 실데이터 벌크 수집 완료! 총 ${Object.keys(usageData).length}건.`);
}

fetchMarchViews().catch(console.error);
