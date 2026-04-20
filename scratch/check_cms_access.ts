import { youtube_v3, youtubepartner_v1 } from "@googleapis/youtubePartner";
// Since I'm not sure about the exact package structure, I'll use the standard 'googleapis' way
import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";

async function checkContentOwners() {
    const auth = await getAuthClient();
    // Use the correct factory method
    const cms = (google as any).youtubepartner({ version: "v1", auth });

    console.log("--- Checking Accessible Content Owners (Refined) ---");
    try {
        const res = await cms.contentOwners.list({
            fetchMine: true
        });

        if (res.data.items) {
            console.log(`Found ${res.data.items.length} content owners:`);
            res.data.items.forEach((co: any) => {
                console.log(`- ID: ${co.id}`);
                console.log(`  DisplayName: ${co.displayName}`);
            });
        } else {
            console.log("No content owners found.");
        }
    } catch (err: any) {
        console.error(`Error: ${err.message}`);
    }
}

checkContentOwners().catch(console.error);
