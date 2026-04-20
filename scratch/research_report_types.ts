import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";

async function listAllReportTypes() {
    const auth = await getAuthClient();
    const reporting = google.youtubereporting({ version: "v1", auth });

    console.log("--- Listing All Available Report Types ---");
    try {
        const res = await reporting.reportTypes.list({
            includeSystemManaged: true
        });

        if (res.data.reportTypes) {
            console.log(`Found ${res.data.reportTypes.length} report types:`);
            res.data.reportTypes.forEach(rt => {
                console.log(`- ID: ${rt.id}`);
                console.log(`  Name: ${rt.name}`);
                console.log(`  System Managed: ${rt.systemManaged}`);
            });
        } else {
            console.log("No report types found.");
        }
    } catch (err: any) {
        console.error(`Error: ${err.message}`);
    }
}

listAllReportTypes().catch(console.error);
