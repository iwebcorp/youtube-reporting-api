import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

async function listJobs() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  const res = await youtubereporting.jobs.list({
    onBehalfOfContentOwner: "2jFu0i9K0PE3MDrkU_UUfQ", // CMS ID
  });

  const jobs = res.data.jobs || [];
  if (jobs.length === 0) {
    console.log("등록된 Job이 하나도 없습니다.");
  } else {
    console.log(`현재 등록된 Job (${jobs.length}개):`);
    jobs.forEach((job) => {
      console.log(`- [${job.id}] ${job.name} (Type: ${job.reportTypeId}, Created: ${job.createTime})`);
    });
  }
}

listJobs().catch(console.error);
