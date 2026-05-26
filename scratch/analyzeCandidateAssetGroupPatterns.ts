import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function splitTerms(value: string): string[] {
  return clean(value)
    .split(/[;,/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function classifyTitleFeatures(title: string): string[] {
  const normalized = title.toLowerCase();
  const features: string[] = [];
  if (normalized.includes("mr")) features.push("mr");
  if (normalized.includes("inst")) features.push("inst");
  if (normalized.includes("live")) features.push("live");
  if (normalized.includes("official")) features.push("official");
  if (normalized.includes("feat")) features.push("feat");
  if (normalized.includes("pf.")) features.push("pf");
  if (normalized.includes("vn.")) features.push("vn");
  if (normalized.includes("예수")) features.push("jesus");
  if (normalized.includes("광야")) features.push("wilderness");
  if (normalized.includes("말씀")) features.push("word");
  if (normalized.includes("부르신")) features.push("calling");
  if (normalized.includes("하나님")) features.push("god");
  if (normalized.includes("믿음")) features.push("faith");
  if (normalized.includes("주님")) features.push("lord");
  if (normalized.includes("아이") || normalized.includes("꿈이") || normalized.includes("쑥쑥") || normalized.includes("최고로")) {
    features.push("kids");
  }
  return features;
}

function summarize(ids: string[], metadataMap: Record<string, AssetMetadata>) {
  const writerCounts = new Map<string, number>();
  const prefixCounts = new Map<string, number>();
  const claimCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();
  const featureCounts = new Map<string, number>();

  const rows = ids.map((assetId) => {
    const metadata = metadataMap[assetId];
    const title = clean(metadata?.title);
    const customId = clean(metadata?.customId);
    const writers = clean(metadata?.writers);
    const assetType = clean(metadata?.assetType);
    const claimType = clean(metadata?.musicClaimType);
    const rightType = clean(metadata?.compositionRightType);
    const prefix = customId.slice(0, 3);
    if (prefix) prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    if (assetType) typeCounts.set(assetType, (typeCounts.get(assetType) ?? 0) + 1);
    if (claimType) claimCounts.set(claimType, (claimCounts.get(claimType) ?? 0) + 1);
    if (rightType) rightCounts.set(rightType, (rightCounts.get(rightType) ?? 0) + 1);
    for (const writer of splitTerms(writers)) writerCounts.set(writer, (writerCounts.get(writer) ?? 0) + 1);
    for (const feature of classifyTitleFeatures(title)) featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);
    return {
      assetId,
      title,
      customId,
      writers,
      assetType,
      claimType,
      rightType,
      features: classifyTitleFeatures(title),
    };
  });

  const summarizeCounts = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));

  return {
    count: ids.length,
    rows,
    prefixCounts: summarizeCounts(prefixCounts),
    claimCounts: summarizeCounts(claimCounts),
    typeCounts: summarizeCounts(typeCounts),
    rightCounts: summarizeCounts(rightCounts),
    featureCounts: summarizeCounts(featureCounts),
    writerCounts: summarizeCounts(writerCounts).slice(0, 30),
  };
}

function run(): void {
  const cachePath = path.resolve(process.cwd(), process.argv[2] ?? "asset_metadata_cache_split.json");
  const metadataMap = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetMetadata>;

  const adjUpscaleIds = [
    "A871135003790050",
    "A786937401112123",
    "A671078058109816",
    "A675334340745901",
    "A254592334060670",
  ];
  const adjDropIds = [
    "A990808439335783",
    "A925442404114834",
    "A155210189216380",
    "A101673175916007",
    "A365605602273234",
    "A882630661961621",
    "A133471147753518",
  ];
  const subCoreIds = [
    "A265013352348077",
    "A769870766344600",
    "A372256496425008",
    "A174469114304629",
    "A656893023218929",
    "A546216248803724",
  ];
  const subTailIds = [
    "A352487607520882",
    "A813619851905376",
    "A504569537707341",
    "A421285609668433",
    "A236527412538613",
    "A896365985914599",
    "A303305380182268",
    "A639811047248363",
  ];

  console.log(
    JSON.stringify(
      {
        adjustmentUpscale: summarize(adjUpscaleIds, metadataMap),
        adjustmentDrop: summarize(adjDropIds, metadataMap),
        subscriptionCore: summarize(subCoreIds, metadataMap),
        subscriptionTail: summarize(subTailIds, metadataMap),
      },
      null,
      2,
    ),
  );
}

run();
