import * as fs from "fs";
import * as path from "path";
import { parseCsvRows } from "../src/reporting/parsers.js";

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

function fileNameMatchesYearMonth(fileName: string, yearMonth: string): boolean {
  const firstDateToken = fileName.match(/\d{4}-\d{2}|\d{8}|\d{6}/)?.[0];
  return firstDateToken ? firstDateToken.replace(/-/g, "").startsWith(yearMonth) : false;
}

function buildParentRecordingSet(
  ranked: RankedAssetEntry[],
  relationships: Record<string, AssetRelationshipCacheEntry>,
  limit: number,
): Set<string> {
  const parentRecordingIds = new Set<string>();
  for (const entry of ranked.slice(0, limit)) {
    const relationship = relationships[entry.assetId];
    if (!relationship) {
      continue;
    }
    const allRelations = relationship.allRelations ?? [];
    const assetMetadata = relationship.assetMetadata ?? {};
    for (const relation of allRelations) {
      const parentAssetId = String(relation.parentAssetId ?? "").trim();
      if (!parentAssetId) continue;
      if (String(assetMetadata[parentAssetId]?.["type"] ?? "").trim() === "sound_recording") {
        parentRecordingIds.add(parentAssetId);
      }
    }
  }
  return parentRecordingIds;
}

async function run(): Promise<void> {
  const yearMonth = process.argv[2] ?? "202604";
  const limit = Number(process.argv[3] ?? "250");
  const rankedPath = path.resolve(process.cwd(), "scratch/ad_pub_26_3_ranked_assets.json");
  const relationshipPath = path.resolve(process.cwd(), "scratch/ad_pub_26_3_top250_relationships.json");
  const reportDir = path.resolve(process.cwd(), "reports");
  const ranked = JSON.parse(fs.readFileSync(rankedPath, "utf-8")) as RankedAssetEntry[];
  const relationships = JSON.parse(fs.readFileSync(relationshipPath, "utf-8")) as Record<string, AssetRelationshipCacheEntry>;
  const parentRecordingIds = buildParentRecordingSet(ranked, relationships, limit);

  const byCountryUploader = new Map<string, number>();
  let total = 0;
  for (const fileName of fs.readdirSync(reportDir)) {
    if (!fileName.endsWith("content_owner_asset_estimated_revenue_a1.csv")) continue;
    if (!fileNameMatchesYearMonth(fileName, yearMonth)) continue;
    const rows = await parseCsvRows(path.join(reportDir, fileName));
    for (const row of rows) {
      const assetId = (row["asset_id"] ?? "").trim();
      if (!parentRecordingIds.has(assetId)) continue;
      const value = Number((row["estimated_partner_ad_revenue"] ?? "0").trim()) || 0;
      total += value;
      const key = `${(row["country_code"] ?? "").trim() || "(blank)"}|${(row["uploader_type"] ?? "").trim() || "(blank)"}|${(row["claimed_status"] ?? "").trim() || "(blank)"}`;
      byCountryUploader.set(key, (byCountryUploader.get(key) ?? 0) + value);
    }
  }

  console.log(`[SumEstimatedRevenueForParentRecordings] limit=${limit} parentRecordingIds=${parentRecordingIds.size} total=${total.toFixed(12)}`);
  for (const [key, value] of Array.from(byCountryUploader.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`${key}\t${value.toFixed(12)}`);
  }
}

run().catch((error) => {
  console.error("[SumEstimatedRevenueForParentRecordings] Failed.", error);
  process.exitCode = 1;
});
