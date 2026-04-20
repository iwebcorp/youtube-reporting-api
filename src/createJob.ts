import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";

const cfg = loadConfig();

async function createJob() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  const res = await youtubereporting.jobs.create({
    onBehalfOfContentOwner: cfg.contentOwnerId,
    requestBody: {
      reportTypeId: "content_owner_asset_estimated_revenue_a1", // 수익 리포트 타입으로 수정
      name: "Asset Revenue Report Job",
    },
  });

  console.log("Job 등록 완료!");
  console.log("Job ID:", res.data.id);
  console.log("Report Type:", res.data.reportTypeId);
  console.log("생성일:", res.data.createTime);
}

createJob().catch(console.error);
