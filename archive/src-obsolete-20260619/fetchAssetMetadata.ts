import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

// Define the structure of the data we'll save in the cache
export interface AssetMeta {
  customId: string;
  isrc: string;
  upc: string;
  title: string;
  artist: string;
  label: string;
  // Publishing fields
  iswc: string;
  hfa: string;
  writers: string;
  rightType: string;
}

const cfg = loadConfig();

async function fetchAssetMetadata() {
  const auth = await getAuthClient();
  const reportDir = path.join(process.cwd(), cfg.reportDir);
  const cacheFile = path.join(process.cwd(), cfg.cacheFile);

  // Load existing cache
  let metadata: Record<string, AssetMeta> = {};
  if (fs.existsSync(cacheFile)) {
    metadata = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    console.log(`Existing cache: ${Object.keys(metadata).length} assets`);
  }

  // Find all unique asset_ids in reports
  const files = fs.readdirSync(reportDir).filter(f => f.endsWith(".csv"));
  const assetIds = new Set<string>();

  console.log("Reading reports to find unique asset IDs...");
  for (const file of files) {
    const content = fs.readFileSync(path.join(reportDir, file), "utf-8");
    const lines = content.split("\n").slice(1);
    for (const rawLine of lines) {
      const cols = rawLine.trim().split(",");
      if (cols.length < 4) continue;
      // Depending on report, asset_id is usually col index 3 (e.g. content_owner_video_revenue_a1)
      // We check if it looks like an asset id (A...)
      const potentialAssetId = cols[3];
      if (potentialAssetId && potentialAssetId.startsWith("A")) {
        assetIds.add(potentialAssetId);
      }
    }
  }

  // Filter out IDs that are already cached
  const unknownAssetIds = Array.from(assetIds).filter(id => !metadata[id]);
  
  if (unknownAssetIds.length === 0) {
    console.log("No new asset IDs to fetch. Cache is up-to-date!");
    return;
  }

  console.log(`Fetching metadata for ${unknownAssetIds.length} assets...`);

  // Max IDs per request is 50 for most YouTube APIs
  const batchSize = 50;
  for (let i = 0; i < unknownAssetIds.length; i += batchSize) {
    const batch = unknownAssetIds.slice(i, i + batchSize);
    const idsParam = batch.join(",");

    try {
      const res = await auth.request<any>({
        url: `https://www.googleapis.com/youtube/partner/v1/assets?id=${idsParam}&onBehalfOfContentOwner=${cfg.contentOwnerId}&fetchMetadata=effective`,
      });

      if (res.data.items) {
        for (const item of res.data.items) {
          const id = item.id;
          const meta = item.metadata || {};
          
          metadata[id] = {
            customId: meta.customId || "",
            isrc: meta.isrc || "",
            upc: meta.upc || meta.grid || "",
            title: meta.title || "",
            artist: meta.artist ? meta.artist.join(", ") : "",
            label: meta.label || "",
            // For fields that might not exist in standard YouTube Asset API, fallback to empty
            iswc: meta.iswc || "",
            hfa: meta.hfa || "",
            writers: meta.writers ? meta.writers.join("|") : "",
            rightType: meta.compositionRightType || "" 
          };
        }
      }
      
      console.log(`Fetched batch: ${Math.min(i + batchSize, unknownAssetIds.length)} / ${unknownAssetIds.length}`);
      
      // Save continuously in case of failure
      fs.writeFileSync(cacheFile, JSON.stringify(metadata, null, 2));

    } catch (err: any) {
      console.error("Error fetching batch:", err.message);
      if (err.response) {
        console.error("Response details:", err.response.data);
      }
      break;
    }
  }

  console.log(`\n✅ Asset metadata cache updated! Total assets cached: ${Object.keys(metadata).length}`);
}

fetchAssetMetadata().catch(err => {
  console.error(err);
  process.exit(1);
});
