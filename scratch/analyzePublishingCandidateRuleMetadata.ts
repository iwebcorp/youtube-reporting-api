import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

interface CandidateRulesFile {
  yearMonth: string;
  adjustment: {
    upscaleAssetIds: string[];
    dropAssetIds: string[];
    alternatives?: Array<{ name: string; dropAssetIds: string[] }>;
  };
  subscription: {
    exclusionKeys: string[];
  };
}

interface SubscriptionCandidateEntry {
  ownership: string;
  assetId: string;
  customId: string;
  probeTitle: string;
  metadata: AssetMetadata | null;
}

interface RelationshipAssetMetadataEntry {
  assetId: string;
  type?: string;
  customId?: string;
  title?: string;
  metadata?: {
    title?: string;
    writer?: string[];
  };
}

interface RelationshipRecord {
  assetId: string;
  assetMetadata?: Record<string, RelationshipAssetMetadataEntry>;
  allRelations?: Array<{
    parentAssetId?: string;
    childAssetId?: string;
  }>;
  relatedAssetIds?: string[];
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function splitTerms(value: string | undefined): string[] {
  return clean(value)
    .split(/[;,/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function classifyTitleFeatures(title: string): string[] {
  const normalized = clean(title).toLowerCase();
  const features: string[] = [];
  if (normalized.includes("jesus") || normalized.includes("예수")) features.push("jesus");
  if (normalized.includes("feat")) features.push("feat");
  if (normalized.includes("mr")) features.push("mr");
  if (normalized.includes("live")) features.push("live");
  if (normalized.includes("광야") || normalized.includes("wilderness")) features.push("wilderness");
  if (normalized.includes("부르신") || normalized.includes("calling")) features.push("calling");
  if (normalized.includes("말씀") || normalized.includes("word")) features.push("word");
  if (normalized.includes("왕")) features.push("king");
  if (normalized.includes("기도")) features.push("prayer");
  if (normalized.includes("은혜")) features.push("grace");
  if (normalized.includes("믿음")) features.push("faith");
  if (normalized.includes("사랑")) features.push("love");
  if (normalized.includes("축복")) features.push("blessing");
  if (normalized.includes("광야")) features.push("desert");
  return features;
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function topEntries(map: Map<string, number>, limit = 20): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function summarizeMetas(entries: Array<{ title: string; customId: string; metadata: AssetMetadata | null }>) {
  const customPrefixCounts = new Map<string, number>();
  const writerCounts = new Map<string, number>();
  const assetTypeCounts = new Map<string, number>();
  const claimTypeCounts = new Map<string, number>();
  const rightTypeCounts = new Map<string, number>();
  const featureCounts = new Map<string, number>();

  for (const entry of entries) {
    const metadata = entry.metadata;
    const customId = clean(metadata?.customId || entry.customId);
    increment(customPrefixCounts, customId.slice(0, 3));
    increment(assetTypeCounts, clean(metadata?.assetType));
    increment(claimTypeCounts, clean(metadata?.musicClaimType));
    increment(rightTypeCounts, clean(metadata?.compositionRightType));
    for (const writer of splitTerms(metadata?.writers)) {
      increment(writerCounts, writer);
    }
    for (const feature of classifyTitleFeatures(clean(metadata?.title || entry.title))) {
      increment(featureCounts, feature);
    }
  }

  return {
    customPrefixes: topEntries(customPrefixCounts),
    assetTypes: topEntries(assetTypeCounts),
    claimTypes: topEntries(claimTypeCounts),
    rightTypes: topEntries(rightTypeCounts),
    writers: topEntries(writerCounts),
    titleFeatures: topEntries(featureCounts),
  };
}

function parseSubscriptionKey(key: string, metadataMap: Record<string, AssetMetadata>): SubscriptionCandidateEntry {
  const [ownership, assetId, customId, probeTitle] = key.split("|");
  return {
    ownership: clean(ownership),
    assetId: clean(assetId),
    customId: clean(customId),
    probeTitle: clean(probeTitle),
    metadata: metadataMap[clean(assetId)] ?? null,
  };
}

function relationshipToMetadata(
  assetId: string,
  relationships: Record<string, RelationshipRecord>,
): AssetMetadata | null {
  const record = relationships[assetId];
  const child = record?.assetMetadata?.[assetId];
  if (!child) {
    return null;
  }

  return {
    assetId,
    title: clean(child.title || child.metadata?.title),
    customId: clean(child.customId),
    isrc: "",
    iswc: "",
    hfa: "",
    upc: "",
    writers: (child.metadata?.writer ?? []).join(", "),
    artist: "",
    album: "",
    label: "",
    assetType: clean(child.type),
    musicClaimType: "",
    compositionRightType: "",
    channelId: "",
  };
}

function run(): void {
  const rulesPath = path.resolve(process.cwd(), process.argv[2] ?? "publishing_royalty_202604_candidate_rules.json");
  const metadataPath = path.resolve(process.cwd(), process.argv[3] ?? "asset_metadata_cache_split.json");
  const relationshipPath = path.resolve(process.cwd(), process.argv[4] ?? "scratch/ad_pub_adj_relationships.json");

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8")) as CandidateRulesFile;
  const metadataMap = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as Record<string, AssetMetadata>;
  const relationships = JSON.parse(fs.readFileSync(relationshipPath, "utf-8")) as Record<string, RelationshipRecord>;

  const adjustmentUpscales = rules.adjustment.upscaleAssetIds.map((assetId) => ({
    assetId,
    title: clean(metadataMap[assetId]?.title || relationshipToMetadata(assetId, relationships)?.title),
    customId: clean(metadataMap[assetId]?.customId || relationshipToMetadata(assetId, relationships)?.customId),
    metadata: metadataMap[assetId] ?? relationshipToMetadata(assetId, relationships),
  }));

  const adjustmentDrops = rules.adjustment.dropAssetIds.map((assetId) => ({
    assetId,
    title: clean(metadataMap[assetId]?.title || relationshipToMetadata(assetId, relationships)?.title),
    customId: clean(metadataMap[assetId]?.customId || relationshipToMetadata(assetId, relationships)?.customId),
    metadata: metadataMap[assetId] ?? relationshipToMetadata(assetId, relationships),
  }));

  const subscriptionEntries = rules.subscription.exclusionKeys.map((key) => parseSubscriptionKey(key, metadataMap));
  const subscriptionOwnershipCounts = new Map<string, number>();
  for (const entry of subscriptionEntries) {
    increment(subscriptionOwnershipCounts, entry.ownership);
  }

  console.log(
    JSON.stringify(
      {
        yearMonth: rules.yearMonth,
        adjustment: {
          upscaleAssetIds: rules.adjustment.upscaleAssetIds,
          dropAssetIds: rules.adjustment.dropAssetIds,
          upscaleSummary: summarizeMetas(adjustmentUpscales),
          dropSummary: summarizeMetas(adjustmentDrops),
        },
        subscription: {
          exclusionKeyCount: rules.subscription.exclusionKeys.length,
          ownerships: topEntries(subscriptionOwnershipCounts),
          summary: summarizeMetas(
            subscriptionEntries.map((entry) => ({
              title: entry.probeTitle,
              customId: entry.customId,
              metadata: entry.metadata,
            })),
          ),
        },
      },
      null,
      2,
    ),
  );
}

run();
