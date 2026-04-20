import * as fs from "fs";
import * as path from "path";
import { AssetClassifier } from "../src/assetClassifier.js";

async function identifyPublishing() {
    const classifier = new AssetClassifier();
    await classifier.initialize(path.join(process.cwd(), "인접"), path.join(process.cwd(), "저작"));
    
    // We get assets from the "저작" folder processing
    const publishingAssets = Array.from((classifier as any).publishingAssets || []);
    console.log(`identified ${publishingAssets.length} publishing assets.`);
    
    fs.writeFileSync(path.join(process.cwd(), "publishing_asset_ids.json"), JSON.stringify(publishingAssets, null, 2));
}

identifyPublishing().catch(console.error);
