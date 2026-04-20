import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function listJobs() {
  const auth = await getAuthClient();
  const reporting = google.youtubereporting({ version: "v1", auth });

  console.log("--- Listing All Jobs for Content Owner ---");
  const jobsRes = await reporting.jobs.list({ onBehalfOfContentOwner: cfg.contentOwnerId });
  const jobs = jobsRes.data.jobs || [];
  
  jobs.forEach(j => {
    console.log(`- Job: ${j.name} | Type: ${j.reportTypeId} | ID: ${j.id}`);
  });
}

listJobs().catch(console.error);
