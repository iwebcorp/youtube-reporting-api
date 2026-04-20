import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

async function mapJobs() {
    const auth = await getAuthClient();
    const reporting = (google as any).youtubereporting({ version: "v1", auth });
    const cfg = loadConfig();

    const res = await reporting.jobs.list({
        onBehalfOfContentOwner: cfg.contentOwnerId
    });

    const jobs = res.data.jobs || [];
    const mapping: Record<string, string> = {};
    
    console.log("Job ID -> Report Type Mapping:");
    jobs.forEach((j: any) => {
        mapping[j.id!] = j.reportTypeId!;
        console.log(`${j.id} -> ${j.reportTypeId}`);
    });
    
    fs.writeFileSync(path.join(process.cwd(), "job_id_mapping.json"), JSON.stringify(mapping, null, 2));
    console.log("✅ Job mapping saved to job_id_mapping.json");
}

mapJobs().catch(console.error);
