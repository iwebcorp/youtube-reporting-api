import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function listReportingJobs() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  console.log("--- Listing Reporting Jobs ---");
  try {
    const res = await reporting.jobs.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
    });
    
    if (res.data.jobs) {
      res.data.jobs.forEach(job => {
        console.log(`- Job: ${job.name} (Type: ${job.reportTypeId}, ID: ${job.id})`);
      });
    } else {
      console.log("No reporting jobs found.");
    }
  } catch (err: any) {
    console.error(`❌ Failed to list jobs: ${err.message}`);
  }

  console.log("\n--- Listing Available Report Types ---");
  try {
    const res = await reporting.reportTypes.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
    });
    if (res.data.reportTypes) {
      res.data.reportTypes.forEach(rt => {
        console.log(`- Report Type: ${rt.name} (${rt.id})`);
      });
    }
  } catch (err: any) {
    console.error(`❌ Failed to list report types: ${err.message}`);
  }
}

listReportingJobs().catch(console.error);
