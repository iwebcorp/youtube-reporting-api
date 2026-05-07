import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const targetTypes = new Set([
  "content_owner_asset_ad_revenue_raw_a1",
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
  "music_content_owner_asset_red_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_summary_a1",
]);

async function run(): Promise<void> {
  const cfg = loadConfig();
  const auth = await getAuthClient();
  const yt = google.youtubereporting({ version: "v1", auth });

  let pageToken: string | undefined;
  const jobs: { id: string; reportTypeId: string }[] = [];
  do {
    const response = await yt.jobs.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
      includeSystemManaged: true,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const job of response.data.jobs ?? []) {
      if (job.id && job.reportTypeId && targetTypes.has(job.reportTypeId)) {
        jobs.push({ id: job.id, reportTypeId: job.reportTypeId });
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  for (const job of jobs.sort((a, b) => a.reportTypeId.localeCompare(b.reportTypeId))) {
    const reports: { startTime?: string | null; endTime?: string | null; createTime?: string | null }[] = [];
    let reportPageToken: string | undefined;
    do {
      const response = await yt.jobs.reports.list({
        onBehalfOfContentOwner: cfg.contentOwnerId,
        jobId: job.id,
        ...(reportPageToken ? { pageToken: reportPageToken } : {}),
      });
      reports.push(...(response.data.reports ?? []));
      reportPageToken = response.data.nextPageToken ?? undefined;
    } while (reportPageToken);

    const latest = reports
      .sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)))
      .slice(0, 8)
      .map((report) => `${report.startTime ?? ""} -> ${report.endTime ?? ""} created=${report.createTime ?? ""}`);

    console.log(`\n${job.reportTypeId} job=${job.id} reports=${reports.length}`);
    for (const line of latest) {
      console.log(`  ${line}`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
