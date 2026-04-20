import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

const cfg = loadConfig();

async function testNonFinancialReport() {
    const auth = await getAuthClient();
    const reporting = google.youtubereporting({ version: "v1", auth });

    console.log("--- Testing Non-Financial Report Access ---");
    try {
        // 1. Try to list report types filtered by contentOwnerId
        const res = await reporting.reportTypes.list({
            onBehalfOfContentOwner: cfg.contentOwnerId
        });

        console.log("Accessible Report Types for CMS:");
        if (res.data.reportTypes) {
            res.data.reportTypes.forEach(rt => console.log(`- ${rt.id}`));
        } else {
            console.log("No report types found for this CMS.");
        }

    } catch (err: any) {
        console.error(`❌ Reporting API Error: ${err.message}`);
    }
}

testNonFinancialReport().catch(console.error);
