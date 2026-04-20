import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

async function downloadCombinedReports() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  const jobId = "b4ae1d9d-c096-4d6b-9b82-7792f2e5f202"; // content_owner_asset_combined_a3 Job ID
  const typeId = "content_owner_asset_combined_a3";

  console.log(`\n--- Downloading reports for Job: ${typeId} ---`);
  const dir = path.join(process.cwd(), "reports", "combined");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const reportsRes = await reporting.jobs.reports.list({
    jobId: jobId,
    onBehalfOfContentOwner: cfg.contentOwnerId,
    startTimeAtOrAfter: "2026-03-01T00:00:00Z"
  });

  const reports = reportsRes.data.reports || [];
  console.log(`Found ${reports.length} potential reports.`);

  for (const r of reports) {
    if (r.startTime! >= "2026-03-01" && r.startTime! <= "2026-04-05") {
      const fileName = `${typeId}_${r.startTime?.split("T")[0]}_${r.id}.csv`;
      const filePath = path.join(dir, fileName);
      
      if (fs.existsSync(filePath)) {
        console.log(`  [Skip] Already exists: ${fileName}`);
        continue;
      }

      console.log(`  [Download] ${fileName}...`);
      try {
        const mediaRes = await reporting.media.download({
          resourceName: r.downloadUrl!,
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
  console.log("\n✅ Combined reports download complete.");
}

downloadCombinedReports().catch(console.error);
