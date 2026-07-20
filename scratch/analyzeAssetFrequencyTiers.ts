import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

interface TierAsset {
  count: number;
  assetId: string;
  title: string;
  ownership?: string;
  baseRevenue?: number;
  upscaleDelta?: number;
  customId?: string;
  writers?: string;
  assetType?: string;
  musicClaimType?: string;
  features?: string[];
}

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
  if (normalized.includes("live")) features.push("live");
  if (normalized.includes("feat")) features.push("feat");
  if (normalized.includes("pf.")) features.push("pf");
  if (normalized.includes("vn.")) features.push("vn");
  if (normalized.includes("jesus") || normalized.includes("예수")) features.push("jesus");
  if (normalized.includes("광야")) features.push("wilderness");
  if (normalized.includes("부르신")) features.push("calling");
  if (normalized.includes("말씀")) features.push("word");
  if (normalized.includes("하나님")) features.push("god");
  if (normalized.includes("믿음")) features.push("faith");
  if (normalized.includes("주님")) features.push("lord");
  if (normalized.includes("쑥쑥") || normalized.includes("꿈이") || normalized.includes("최고로") || normalized.includes("학령")) {
    features.push("kids");
  }
  return features;
}

function summarizeTier(name: string, assets: TierAsset[], metadataMap: Record<string, AssetMetadata>) {
  const writerCounts = new Map<string, number>();
  const claimCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const featureCounts = new Map<string, number>();
  const prefixCounts = new Map<string, number>();

  for (const asset of assets) {
    const metadata = metadataMap[asset.assetId];
    const writers = clean(asset.writers ?? metadata?.writers);
    const claimType = clean(asset.musicClaimType ?? metadata?.musicClaimType);
    const assetType = clean(asset.assetType ?? metadata?.assetType);
    const customId = clean(asset.customId ?? metadata?.customId);
    const title = clean(asset.title || metadata?.title);
    for (const writer of splitTerms(writers)) writerCounts.set(writer, (writerCounts.get(writer) ?? 0) + asset.count);
    if (claimType) claimCounts.set(claimType, (claimCounts.get(claimType) ?? 0) + asset.count);
    if (assetType) typeCounts.set(assetType, (typeCounts.get(assetType) ?? 0) + asset.count);
    if (customId) prefixCounts.set(customId.slice(0, 3), (prefixCounts.get(customId.slice(0, 3)) ?? 0) + asset.count);
    for (const feature of classifyTitleFeatures(title)) featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + asset.count);
  }

  const summarizeCounts = (map: Map<string, number>, slice = 15) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, slice).map(([key, count]) => ({ key, count }));

  return {
    tier: name,
    count: assets.length,
    assets,
    claimCounts: summarizeCounts(claimCounts),
    typeCounts: summarizeCounts(typeCounts),
    prefixCounts: summarizeCounts(prefixCounts),
    featureCounts: summarizeCounts(featureCounts),
    writerCounts: summarizeCounts(writerCounts, 20),
  };
}

function run(): void {
  const cachePath = path.resolve(process.cwd(), process.argv[2] ?? "asset_metadata_cache_split.json");
  const jsonPath = path.resolve(process.cwd(), process.argv[3]);
  const mode = process.argv[4] ?? "repeated";
  const metadataMap = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetMetadata>;
  const payload = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const assets: TierAsset[] = payload[mode] ?? payload;

  const always = assets.filter((asset) => asset.count >= 20);
  const often = assets.filter((asset) => asset.count >= 10 && asset.count < 20);
  const sometimes = assets.filter((asset) => asset.count >= 5 && asset.count < 10);
  const fringe = assets.filter((asset) => asset.count < 5);

  console.log(
    JSON.stringify(
      {
        source: jsonPath,
        mode,
        always: summarizeTier("always", always, metadataMap),
        often: summarizeTier("often", often, metadataMap),
        sometimes: summarizeTier("sometimes", sometimes, metadataMap),
        fringe: summarizeTier("fringe", fringe, metadataMap),
      },
      null,
      2,
    ),
  );
}

run();
