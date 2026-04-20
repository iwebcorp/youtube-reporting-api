import * as fs from "fs";
import * as path from "path";
import { AssetClassifier } from "../src/assetClassifier.js";

async function diagnoseClassification() {
  const classifier = new AssetClassifier();
  await classifier.initialize(path.join(process.cwd(), "인접"), path.join(process.cwd(), "저작"));

  const reportsDir = path.join(process.cwd(), "reports");
  const files = fs.readdirSync(reportsDir).filter(f => f.startsWith("report_2026-03-") && f.endsWith(".csv"));

  const counts: any = { Neighboring: 0, Publishing: 0, Unknown: 0 };
  const assetMetaCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "asset_metadata_cache.json"), "utf-8"));

  const seen = new Set();
  
  for (const file of files.slice(0, 5)) { // 5개 파일만 샘플링
    const content = fs.readFileSync(path.join(reportsDir, file), "utf-8");
    const lines = content.split("\n");
    lines.slice(1).forEach(line => {
      const aid = line.split(",")[3]; // asset_id
      if (!aid || seen.has(aid)) return;
      seen.add(aid);

      const m = assetMetaCache[aid] || {};
      const cat = classifier.classify(aid, { customId: m.customId, isrc: m.isrc });
      counts[cat] = (counts[cat] || 0) + 1;
    });
  }

  console.log("--- Classification Diagnosis (Sample) ---");
  console.log(counts);
  console.log(`Total Unique Assets Check: ${seen.size}`);
}

diagnoseClassification().catch(console.error);
