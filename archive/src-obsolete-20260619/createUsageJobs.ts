import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";

const cfg = loadConfig();

async function createUsageJobs() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  const reportTypes = ["content_owner_asset_usage_a1", "content_owner_asset_combined_a3"];

  console.log("[Reporting] 조회수 및 통합 리포트 Job 생성을 시도합니다...");

  for (const type of reportTypes) {
    try {
      const res = await reporting.jobs.create({
        onBehalfOfContentOwner: cfg.contentOwnerId,
        requestBody: {
          reportTypeId: type,
          name: `Auto Generated ${type} Job`,
        },
      });
      console.log(`✅ Job 생성 성공: ${type}`);
      console.log(`   - ID: ${res.data.id}`);
    } catch (err: any) {
      if (err.message.includes("already exists")) {
        console.log(`ℹ️ [알림] ${type} Job이 이미 존재합니다.`);
      } else {
        console.error(`❌ Job 생성 실패: ${type} - ${err.message}`);
      }
    }
  }
}

createUsageJobs().catch(console.error);
