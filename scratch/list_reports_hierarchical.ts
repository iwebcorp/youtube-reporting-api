import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function listAllReports() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  console.log("--- Step 1: Listing Jobs ---");
  const jobsRes = await reporting.jobs.list({
    onBehalfOfContentOwner: cfg.contentOwnerId
  });

  const jobs = jobsRes.data.jobs || [];
  console.log(`Found ${jobs.length} jobs.`);

  for (const job of jobs) {
    const interestingTypes = [
      "content_owner_playback_location_a3",
      "content_owner_asset_video_relationship_a1",
      "content_owner_asset_estimated_revenue_a1"
    ];

    if (interestingTypes.includes(job.reportTypeId!)) {
      console.log(`\n--- Listing Reports for Job: ${job.name} (${job.reportTypeId}) ---`);
      try {
        const reportsRes = await reporting.jobs.reports.list({
          jobId: job.id!,
          onBehalfOfContentOwner: cfg.contentOwnerId,
          startTimeAtOrAfter: "2026-03-01T00:00:00Z"
        });

        if (reportsRes.data.reports) {
          reportsRes.data.reports.forEach(r => {
            console.log(`  - Report ID: ${r.id} | Start: ${r.startTime} | URL: ${r.downloadUrl}`);
          });
        } else {
          console.log("  No reports found for this job in the given timeframe.");
        }
      } catch (err: any) {
        console.error(`  ❌ Error listing reports: ${err.message}`);
      }
    }
  }
}

listAllReports().catch(console.error);
