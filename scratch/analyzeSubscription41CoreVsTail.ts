import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

const CORE_IDS = [
  "A265013352348077",
  "A769870766344600",
  "A372256496425008",
  "A174469114304629",
  "A656893023218929",
  "A546216248803724",
];

const TAIL_IDS = [
  "A352487607520882",
  "A813619851905376",
  "A504569537707341",
  "A421285609668433",
  "A236527412538613",
  "A896365985914599",
  "A303305380182268",
  "A639811047248363",
];

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function splitTerms(value: string): string[] {
  return clean(value)
    .split(/[;,/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function summarize(ids: string[], metadataMap: Record<string, AssetMetadata>) {
  const writerCounts = new Map<string, number>();
  const claimCounts = new Map<string, number>();
  const customPrefixCounts = new Map<string, number>();
  const assetTypeCounts = new Map<string, number>();

  const rows = ids.map((assetId) => {
    const metadata = metadataMap[assetId];
    for (const writer of splitTerms(metadata?.writers ?? "")) {
      writerCounts.set(writer, (writerCounts.get(writer) ?? 0) + 1);
    }
    const claimType = clean(metadata?.musicClaimType);
    const customPrefix = clean(metadata?.customId).slice(0, 3);
    const assetType = clean(metadata?.assetType);
    if (claimType) claimCounts.set(claimType, (claimCounts.get(claimType) ?? 0) + 1);
    if (customPrefix) customPrefixCounts.set(customPrefix, (customPrefixCounts.get(customPrefix) ?? 0) + 1);
    if (assetType) assetTypeCounts.set(assetType, (assetTypeCounts.get(assetType) ?? 0) + 1);
    return {
      assetId,
      title: metadata?.title ?? "",
      customId: metadata?.customId ?? "",
      writers: metadata?.writers ?? "",
      assetType: metadata?.assetType ?? "",
      musicClaimType: metadata?.musicClaimType ?? "",
    };
  });

  const summarizeCounts = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));

  return {
    rows,
    writerCounts: summarizeCounts(writerCounts),
    claimCounts: summarizeCounts(claimCounts),
    customPrefixCounts: summarizeCounts(customPrefixCounts),
    assetTypeCounts: summarizeCounts(assetTypeCounts),
  };
}

function run(): void {
  const cachePath = path.resolve(process.cwd(), process.argv[2] ?? "asset_metadata_cache_split.json");
  const metadataMap = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetMetadata>;

  console.log(
    JSON.stringify(
      {
        core: summarize(CORE_IDS, metadataMap),
        tail: summarize(TAIL_IDS, metadataMap),
      },
      null,
      2,
    ),
  );
}

run();
