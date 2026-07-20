import * as fs from "fs";
import * as path from "path";

interface CandidateRulesFile {
  adjustment: {
    upscaleAssetIds: string[];
    dropAssetIds: string[];
  };
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
  relatedAssetIds?: string[];
  assetMetadata?: Record<string, RelationshipAssetMetadataEntry>;
  allRelations?: Array<{
    parentAssetId?: string;
    childAssetId?: string;
  }>;
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function resolveCandidateSummary(
  assetId: string,
  relationships: Record<string, RelationshipRecord>,
) {
  const record = relationships[assetId];
  const child = record?.assetMetadata?.[assetId];
  const parentId =
    clean(record?.allRelations?.[0]?.parentAssetId) ||
    clean(record?.relatedAssetIds?.[0]);
  const parent = parentId ? record?.assetMetadata?.[parentId] : undefined;

  return {
    assetId,
    childType: clean(child?.type),
    childCustomId: clean(child?.customId),
    childTitle: clean(child?.title || child?.metadata?.title),
    childWriters: child?.metadata?.writer ?? [],
    parentAssetId: parentId,
    parentType: clean(parent?.type),
    parentCustomId: clean(parent?.customId),
    parentTitle: clean(parent?.title || parent?.metadata?.title),
    parentWriters: parent?.metadata?.writer ?? [],
  };
}

function summarize(entries: ReturnType<typeof resolveCandidateSummary>[]) {
  const childTypes = new Map<string, number>();
  const parentTypes = new Map<string, number>();
  const parentPrefixes = new Map<string, number>();

  for (const entry of entries) {
    childTypes.set(entry.childType, (childTypes.get(entry.childType) ?? 0) + 1);
    parentTypes.set(entry.parentType, (parentTypes.get(entry.parentType) ?? 0) + 1);
    const prefix = clean(entry.parentCustomId).slice(0, 3);
    if (prefix) {
      parentPrefixes.set(prefix, (parentPrefixes.get(prefix) ?? 0) + 1);
    }
  }

  const sortMap = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));

  return {
    childTypes: sortMap(childTypes),
    parentTypes: sortMap(parentTypes),
    parentPrefixes: sortMap(parentPrefixes),
  };
}

function run(): void {
  const rulesPath = path.resolve(process.cwd(), process.argv[2] ?? "publishing_royalty_202604_candidate_rules.json");
  const relationshipsPath = path.resolve(process.cwd(), process.argv[3] ?? "scratch/ad_pub_adj_relationships.json");

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8")) as CandidateRulesFile;
  const relationships = JSON.parse(fs.readFileSync(relationshipsPath, "utf-8")) as Record<string, RelationshipRecord>;

  const upscaleEntries = rules.adjustment.upscaleAssetIds.map((assetId) => resolveCandidateSummary(assetId, relationships));
  const dropEntries = rules.adjustment.dropAssetIds.map((assetId) => resolveCandidateSummary(assetId, relationships));

  console.log(
    JSON.stringify(
      {
        upscaleEntries,
        dropEntries,
        upscaleSummary: summarize(upscaleEntries),
        dropSummary: summarize(dropEntries),
      },
      null,
      2,
    ),
  );
}

run();
