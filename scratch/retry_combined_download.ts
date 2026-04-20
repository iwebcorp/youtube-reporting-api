import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

async function retryDownloadCombined() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  const jobId = "b4ae1d9d-c096-4d6b-9b82-7792f2e5f202";

  console.log("--- Retrying Combined Report Download ---");
  try {
    const reportsRes = await reporting.jobs.reports.list({
      jobId: jobId,
      onBehalfOfContentOwner: cfg.contentOwnerId,
      startTimeAtOrAfter: "2026-03-01T00:00:00Z"
    });

    if (reportsRes.data.reports && reportsRes.data.reports.length > 0) {
      const r = reportsRes.data.reports[0];
      console.log(`Target Report: ${r.id} | Start: ${r.startTime}`);

      const mediaRes = await reporting.media.download({
        resourceName: r.downloadUrl!,
      }, { responseType: "stream" });

      const testPath = path.join(process.cwd(), "scratch", "test_combined.csv");
      const dest = fs.createWriteStream(testPath);
      
      await new Promise((resolve, reject) => {
        mediaRes.data
          .pipe(dest)
          .on("finish", resolve)
          .on("error", reject);
      });
      console.log("✅ Download Successful!");
      
      // Check the first few lines
      const head = fs.readFileSync(testPath, "utf-8").split("\n").slice(0, 5);
      console.log("--- Content Preview ---");
      console.log(head.join("\n"));
    } else {
      console.log("No reports found for combined job.");
    }
  } catch (err: any) {
    console.error(`❌ Still failing: ${err.message}`);
    if (err.response) {
        console.error("Response data:", JSON.stringify(err.response.data, null, 2));
    }
  }
}

retryDownloadCombined().catch(console.error);
