import * as fs from "fs";
import * as path from "path";
import { parseCsvRows } from "./reporting/parsers.js";
import { clean } from "./reporting/utils.js";

type CsvRow = Record<string, string>;

interface SampleBucket {
  key: string;
  rows: number;
  assetIds: string[];
}

function parseArgValue(prefix: string): string | null {
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!argument) {
    return null;
  }
  const rawValue = argument.slice(prefix.length).trim();
  return rawValue || null;
}

function classifyBucket(rows: CsvRow[]): string {
  const claimTypes = Array.from(new Set(rows.map((row) => clean(row["Music Claim Type"])).filter(Boolean))).sort();
  const rightTypes = Array.from(new Set(rows.map((row) => clean(row["Composition Right Type"])).filter(Boolean))).sort();
  return `${claimTypes.join("+") || "none"} x ${rightTypes.join("+") || "none"}`;
}

async function run(): Promise<void> {
  const samplePath = path.resolve(
    process.cwd(),
    parseArgValue("--samplePath=") ?? "저작/1.YouTube_kwangsoomedia_pla_M_20260101_20260131_rev_views_by_asset_v1-0.csv",
  );
  const perBucket = Number(parseArgValue("--perBucket=") ?? "12");
  const outputPath = path.resolve(
    process.cwd(),
    parseArgValue("--output=") ?? "scratch/publishing_relationship_sample_asset_ids.json",
  );

  const rows = await parseCsvRows(samplePath, { encoding: "auto" });
  const grouped = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const assetId = clean(row["Asset ID"]);
    if (!assetId) {
      continue;
    }
    const bucket = grouped.get(assetId) ?? [];
    bucket.push(row);
    grouped.set(assetId, bucket);
  }

  const buckets = new Map<string, SampleBucket>();
  for (const [assetId, assetRows] of grouped.entries()) {
    const key = classifyBucket(assetRows);
    const existing = buckets.get(key) ?? { key, rows: assetRows.length, assetIds: [] };
    existing.assetIds.push(assetId);
    buckets.set(key, existing);
  }

  const selectedAssetIds: string[] = [];
  const selectionSummary = Array.from(buckets.values())
    .sort((left, right) => right.assetIds.length - left.assetIds.length)
    .map((bucket) => {
      const picked = bucket.assetIds.slice(0, perBucket);
      selectedAssetIds.push(...picked);
      return {
        bucket: bucket.key,
        population: bucket.assetIds.length,
        picked: picked.length,
      };
    });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(Array.from(new Set(selectedAssetIds)).sort(), null, 2), "utf-8");

  console.log(`[SelectPublishingRelationshipSamples] samplePath=${samplePath}`);
  console.log(`[SelectPublishingRelationshipSamples] selected=${Array.from(new Set(selectedAssetIds)).length}`);
  console.log(`[SelectPublishingRelationshipSamples] wrote ${outputPath}`);
  for (const item of selectionSummary) {
    console.log(
      `[SelectPublishingRelationshipSamples] bucket=${item.bucket} population=${item.population} picked=${item.picked}`,
    );
  }
}

run().catch((error) => {
  console.error("[SelectPublishingRelationshipSamples] Failed.", error);
  process.exitCode = 1;
});
