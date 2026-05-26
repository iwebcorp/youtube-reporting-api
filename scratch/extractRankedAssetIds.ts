import * as fs from "fs";
import * as path from "path";

interface RankedAssetEntry {
  assetId: string;
}

function run(): void {
  const inputPath = path.resolve(process.cwd(), process.argv[2] ?? "scratch/ad_pub_26_3_ranked_assets.json");
  const outputPath = path.resolve(process.cwd(), process.argv[3] ?? "scratch/ad_pub_26_3_top250_asset_ids.json");
  const limit = Number(process.argv[4] ?? "250");
  const parsed = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as RankedAssetEntry[];
  const assetIds = parsed.slice(0, limit).map((entry) => entry.assetId);
  fs.writeFileSync(outputPath, JSON.stringify(assetIds, null, 2), "utf-8");
  console.log(`[ExtractRankedAssetIds] input=${inputPath}`);
  console.log(`[ExtractRankedAssetIds] limit=${limit}`);
  console.log(`[ExtractRankedAssetIds] wrote ${outputPath}`);
}

run();
