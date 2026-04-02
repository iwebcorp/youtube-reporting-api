import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

async function createMetadataJobs() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  const CMS_ID = "2jFu0i9K0PE3MDrkU_UUfQ";

  const jobsToCreate = [
    { type: "content_owner_video_metadata_a1", name: "Video Metadata Job" },
    { type: "content_owner_asset_metadata_a1", name: "Asset Metadata Job" }
  ];

  for (const job of jobsToCreate) {
    try {
      const res = await youtubereporting.jobs.create({
        onBehalfOfContentOwner: CMS_ID,
        requestBody: {
          reportTypeId: job.type,
          name: job.name,
        },
      });

      console.log(`Job [${job.type}] 등록 완료!`);
      console.log("Job ID:", res.data.id);
    } catch (err: any) {
      console.error(`Job [${job.type}] 등록 실패:`, err.message);
    }
  }
}

createMetadataJobs().catch(console.error);
