import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";

const cfg = loadConfig();

async function listReportsToFile() {
  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  const res = await youtubereporting.jobs.reports.list({
    onBehalfOfContentOwner: cfg.contentOwnerId,
    jobId: "80be075c-4239-4943-b42f-59d22c34128c"
  });

  const reports = res.data.reports || [];
  const logContent = reports.map(r => `ID: ${r.id}, Start: ${r.startTime}, End: ${r.endTime}`).join("\n");
  fs.writeFileSync("found_reports.log", logContent);
  console.log(`${reports.length} reports logged to found_reports.log`);
}

listReportsToFile().catch(console.error);
