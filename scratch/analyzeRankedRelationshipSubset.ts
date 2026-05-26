import * as fs from "fs";
import * as path from "path";
import { classifyEmbeddedCover } from "../src/reporting/publishingClassification.js";

interface RankedAssetEntry {
  assetId: string;
  customId: string;
  title: string;
  revenue: number;
  rowCount: number;
  cumulativeRevenue: number;
}

interface AssetRelationshipItem {
  parentAssetId?: string;
  childAssetId?: string;
  [key: string]: unknown;
}

interface AssetRelationshipCacheEntry {
  assetId: string;
  relatedAssetIds?: string[];
  assetMetadata?: Record<string, Record<string, unknown>>;
  allRelations?: AssetRelationshipItem[];
}

function sum(entries: RankedAssetEntry[]): number {
  return entries.reduce((total, entry) => total + entry.revenue, 0);
}

function run(): void {
  const rankedPath = path.resolve(process.cwd(), process.argv[2] ?? "scratch/ad_pub_26_3_ranked_assets.json");
  const relationshipPath = path.resolve(
    process.cwd(),
    process.argv[3] ?? "scratch/ad_pub_26_3_top250_relationships.json",
  );
  const ranked = JSON.parse(fs.readFileSync(rankedPath, "utf-8")) as RankedAssetEntry[];
  const relationships = JSON.parse(fs.readFileSync(relationshipPath, "utf-8")) as Record<string, AssetRelationshipCacheEntry>;

  const joined = ranked
    .slice(0, 250)
    .map((entry) => {
      const relationship = relationships[entry.assetId];
      const heuristic = classifyEmbeddedCover(
        {
          assetId: entry.assetId,
          title: entry.title,
          customId: entry.customId,
          claimTypes: entry.rowCount === 2 ? ["Embedded"] : ["Cover", "Embedded"],
          rightTypes: entry.rowCount === 2 ? ["Mechanical", "Performance"] : ["Mechanical", "Performance"],
        },
        relationship,
      );
      return { entry, heuristic };
    });

  const groups = {
    embedded: joined.filter((item) => item.heuristic.finalType === "embedded"),
    mixed: joined.filter((item) => item.heuristic.finalType === "mixed"),
    cover: joined.filter((item) => item.heuristic.finalType === "cover"),
    unknown: joined.filter((item) => item.heuristic.finalType === "unknown"),
    customIdMatch: joined.filter((item) => item.heuristic.features.customIdMatch),
    noCustomIdMatch: joined.filter((item) => !item.heuristic.features.customIdMatch),
    highTitleSimilarity: joined.filter((item) => item.heuristic.features.titleSimilarity >= 0.85),
    lowTitleSimilarity: joined.filter((item) => item.heuristic.features.titleSimilarity <= 0.4),
  };

  console.log(`[AnalyzeRankedRelationshipSubset] top250Revenue=${sum(ranked.slice(0, 250)).toFixed(12)}`);
  for (const [key, items] of Object.entries(groups)) {
    console.log(`[AnalyzeRankedRelationshipSubset] ${key} count=${items.length} revenue=${sum(items.map((item) => item.entry)).toFixed(12)}`);
  }

  console.log("[AnalyzeRankedRelationshipSubset] top customIdMatch assets");
  for (const item of joined.filter((joinedItem) => joinedItem.heuristic.features.customIdMatch).slice(0, 20)) {
    console.log(
      `${item.entry.assetId}\t${item.entry.customId}\t${item.entry.revenue.toFixed(12)}\t${item.heuristic.finalType}\t${item.heuristic.features.titleSimilarity.toFixed(3)}`,
    );
  }
}

run();
