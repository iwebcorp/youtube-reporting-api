import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";

const cfg = loadConfig();

async function createMetadataJobs() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });


  const jobsToCreate = [
    { type: "content_owner_video_metadata_a1", name: "Video Metadata Job" },
    { type: "content_owner_asset_metadata_a1", name: "Asset Metadata Job" }
  ];

  for (const job of jobsToCreate) {
    try {
      const res = await youtubereporting.jobs.create({
        onBehalfOfContentOwner: cfg.contentOwnerId,
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
