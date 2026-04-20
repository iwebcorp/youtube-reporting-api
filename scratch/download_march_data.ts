import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

async function downloadReports() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  const jobsRes = await reporting.jobs.list({ onBehalfOfContentOwner: cfg.contentOwnerId });
  const jobs = jobsRes.data.jobs || [];

  const targetTypes = {
    "content_owner_playback_location_a3": "playback",
    "content_owner_asset_video_relationship_a1": "mapping"
  };

  for (const job of jobs) {
    const folderName = targetTypes[job.reportTypeId!];
    if (folderName) {
      console.log(`\n--- Downloading reports for Job: ${job.reportTypeId} ---`);
      const dir = path.join(process.cwd(), "reports", folderName);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const reportsRes = await reporting.jobs.reports.list({
        jobId: job.id!,
        onBehalfOfContentOwner: cfg.contentOwnerId,
        startTimeAtOrAfter: "2026-03-01T00:00:00Z"
      });

      const reports = reportsRes.data.reports || [];
      for (const r of reports) {
        // 3월 데이터만 필터 (startTime 기준)
        if (r.startTime! >= "2026-03-01" && r.startTime! <= "2026-04-05") {
          const fileName = `${r.reportTypeId}_${r.startTime?.split("T")[0]}_${r.id}.csv`;
          const filePath = path.join(dir, fileName);
          
          if (fs.existsSync(filePath)) {
            console.log(`  [Skip] Already exists: ${fileName}`);
            continue;
          }

          console.log(`  [Download] ${fileName}...`);
          try {
            const mediaRes = await reporting.media.download({
              resourceName: r.downloadUrl!, // Note: downloadUrl contains the full resource path sometimes
            }, { responseType: "stream" });

            const dest = fs.createWriteStream(filePath);
            await new Promise((resolve, reject) => {
              mediaRes.data
                .pipe(dest)
                .on("finish", resolve)
                .on("error", reject);
            });
          } catch (err: any) {
             console.error(`  ❌ Failed download: ${err.message}`);
          }
        }
      }
    }
  }
  console.log("\n✅ All downloads complete.");
}

downloadReports().catch(console.error);
