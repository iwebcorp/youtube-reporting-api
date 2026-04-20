import * as fs from "fs";
import * as path from "path";
import { parseCsvRows } from "./reporting/parsers.js";
import { classifyEmbeddedCover } from "./reporting/publishingClassification.js";
import { clean } from "./reporting/utils.js";

type CsvRow = Record<string, string>;

interface AssetRelationshipItem {
  parentAssetId?: string;
  childAssetId?: string;
  [key: string]: unknown;
}

interface AssetRelationshipCacheEntry {
  assetId: string;
  relatedAssetIds?: string[];
  assetMetadata?: Record<string, Record<string, unknown>>;
  embeddedRelations?: AssetRelationshipItem[];
  allRelations?: AssetRelationshipItem[];
}

interface SampleAssetLabelSummary {
  assetId: string;
  customId: string;
  title: string;
  rowCount: number;
  claimTypes: string[];
  rightTypes: string[];
  hasEmbedded: boolean;
  hasCover: boolean;
  hasMechanical: boolean;
  hasPerformance: boolean;
  shape: string;
}

interface JoinedAssetAnalysis extends SampleAssetLabelSummary {
  inRelationshipCache: boolean;
  selfType: string;
  relatedAssetIds: string[];
  relatedTypes: string[];
  relatedSoundRecordingIds: string[];
  parentAssetIds: string[];
  childAssetIds: string[];
  parentSoundRecordingIds: string[];
  childSoundRecordingIds: string[];
  hasRelatedSoundRecording: boolean;
  hasParentSoundRecording: boolean;
  hasChildSoundRecording: boolean;
  titleSimilarity: number;
  customIdMatch: boolean;
  parentSoundRecordingCount: number;
  relatedSoundRecordingCount: number;
  relatedAssetTypeCombo: string;
  heuristicFinalType: string;
  heuristicEmbeddedScore: number;
  heuristicCoverScore: number;
  heuristicConfidence: number;
  heuristicReasons: string[];
}

interface CorrelationSummary {
  totalSampleAssets: number;
  assetsInRelationshipCache: number;
  coverAssets: number;
  embeddedAssets: number;
  featureCounts: Record<string, { true: number; false: number }>;
  byShape: Record<string, number>;
}

interface SampledSubsetSummary {
  totalAssets: number;
  coverAssets: number;
  embeddedAssets: number;
  shapes: Record<string, number>;
}

interface ConfusionMatrix {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
}

interface NumericFeatureAverage {
  count: number;
  averages: Record<string, number>;
}

function parseArgValue(prefix: string): string | null {
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!argument) {
    return null;
  }
  const rawValue = argument.slice(prefix.length).trim();
  return rawValue || null;
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => clean(item)).filter(Boolean);
  }
  const cleaned = clean(value);
  return cleaned ? [cleaned] : [];
}

function loadRelationshipCache(cachePath: string): Record<string, AssetRelationshipCacheEntry> {
  if (!fs.existsSync(cachePath)) {
    throw new Error(`[AnalyzePublishingRelationshipCorrelation] Missing relationship cache: ${cachePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetRelationshipCacheEntry>;
  return parsed;
}

function summarizeSampleRows(rows: CsvRow[]): SampleAssetLabelSummary[] {
  const grouped = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const assetId = clean(row["Asset ID"]);
    if (!assetId) {
      continue;
    }
    const existing = grouped.get(assetId) ?? [];
    existing.push(row);
    grouped.set(assetId, existing);
  }

  return Array.from(grouped.entries())
    .map(([assetId, assetRows]) => {
      const claimTypes = Array.from(new Set(assetRows.map((row) => clean(row["Music Claim Type"])).filter(Boolean))).sort();
      const rightTypes = Array.from(
        new Set(assetRows.map((row) => clean(row["Composition Right Type"])).filter(Boolean)),
      ).sort();

      const hasEmbedded = claimTypes.includes("Embedded");
      const hasCover = claimTypes.includes("Cover");
      const hasMechanical = rightTypes.includes("Mechanical");
      const hasPerformance = rightTypes.includes("Performance");

      return {
        assetId,
        customId: clean(assetRows[0]?.["Custom ID"]),
        title: clean(assetRows[0]?.["Asset Title"]),
        rowCount: assetRows.length,
        claimTypes,
        rightTypes,
        hasEmbedded,
        hasCover,
        hasMechanical,
        hasPerformance,
        shape: `${claimTypes.join("+") || "none"} x ${rightTypes.join("+") || "none"}`,
      };
    })
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
}

function analyzeJoinedAsset(
  sampleSummary: SampleAssetLabelSummary,
  relationshipEntry: AssetRelationshipCacheEntry | undefined,
): JoinedAssetAnalysis {
  const heuristic = classifyEmbeddedCover(
    {
      assetId: sampleSummary.assetId,
      title: sampleSummary.title,
      customId: sampleSummary.customId,
      claimTypes: sampleSummary.claimTypes,
      rightTypes: sampleSummary.rightTypes,
    },
    relationshipEntry,
  );
  const assetMetadata = relationshipEntry?.assetMetadata ?? {};
  const selfMetadata = assetMetadata[sampleSummary.assetId] ?? {};
  const selfType = clean(selfMetadata["type"]);
  const relatedAssetIds = (relationshipEntry?.relatedAssetIds ?? []).map((value) => clean(value)).filter(Boolean);

  const relatedTypes = relatedAssetIds
    .map((assetId) => clean(assetMetadata[assetId]?.["type"]))
    .filter(Boolean);

  const relatedSoundRecordingIds = relatedAssetIds.filter(
    (assetId) => clean(assetMetadata[assetId]?.["type"]) === "sound_recording",
  );

  const allRelations = relationshipEntry?.allRelations ?? [];
  const parentAssetIds = Array.from(
    new Set(allRelations.map((relation) => clean(relation.parentAssetId)).filter(Boolean)),
  );
  const childAssetIds = Array.from(
    new Set(allRelations.map((relation) => clean(relation.childAssetId)).filter(Boolean)),
  );

  const parentSoundRecordingIds = parentAssetIds.filter(
    (assetId) => clean(assetMetadata[assetId]?.["type"]) === "sound_recording",
  );
  const childSoundRecordingIds = childAssetIds.filter(
    (assetId) => clean(assetMetadata[assetId]?.["type"]) === "sound_recording",
  );

  return {
    ...sampleSummary,
    inRelationshipCache: Boolean(relationshipEntry),
    selfType,
    relatedAssetIds,
    relatedTypes: Array.from(new Set(relatedTypes)).sort(),
    relatedSoundRecordingIds,
    parentAssetIds,
    childAssetIds,
    parentSoundRecordingIds,
    childSoundRecordingIds,
    hasRelatedSoundRecording: relatedSoundRecordingIds.length > 0,
    hasParentSoundRecording: parentSoundRecordingIds.length > 0,
    hasChildSoundRecording: childSoundRecordingIds.length > 0,
    titleSimilarity: heuristic.features.titleSimilarity,
    customIdMatch: heuristic.features.customIdMatch,
    parentSoundRecordingCount: heuristic.features.parentSoundRecordingCount,
    relatedSoundRecordingCount: heuristic.features.relatedSoundRecordingCount,
    relatedAssetTypeCombo: heuristic.features.relatedAssetTypeCombo,
    heuristicFinalType: heuristic.finalType,
    heuristicEmbeddedScore: heuristic.embeddedScore,
    heuristicCoverScore: heuristic.coverScore,
    heuristicConfidence: heuristic.confidence,
    heuristicReasons: heuristic.reasons,
  };
}

function summarizeCorrelation(joinedAssets: JoinedAssetAnalysis[]): CorrelationSummary {
  const featureNames: Array<keyof Pick<
    JoinedAssetAnalysis,
    "hasEmbedded" | "hasCover" | "hasRelatedSoundRecording" | "hasParentSoundRecording" | "hasChildSoundRecording"
  >> = [
    "hasEmbedded",
    "hasCover",
    "hasRelatedSoundRecording",
    "hasParentSoundRecording",
    "hasChildSoundRecording",
  ];

  const featureCounts: Record<string, { true: number; false: number }> = {};
  for (const featureName of featureNames) {
    featureCounts[featureName] = { true: 0, false: 0 };
  }

  const byShape: Record<string, number> = {};
  for (const asset of joinedAssets) {
    for (const featureName of featureNames) {
      featureCounts[featureName][asset[featureName] ? "true" : "false"] += 1;
    }
    byShape[asset.shape] = (byShape[asset.shape] ?? 0) + 1;
  }

  return {
    totalSampleAssets: joinedAssets.length,
    assetsInRelationshipCache: joinedAssets.filter((asset) => asset.inRelationshipCache).length,
    coverAssets: joinedAssets.filter((asset) => asset.hasCover).length,
    embeddedAssets: joinedAssets.filter((asset) => asset.hasEmbedded).length,
    featureCounts,
    byShape,
  };
}

function buildPairCounts(
  joinedAssets: JoinedAssetAnalysis[],
  leftFeature: keyof JoinedAssetAnalysis,
  rightFeature: keyof JoinedAssetAnalysis,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const asset of joinedAssets) {
    const key = `${leftFeature}=${String(asset[leftFeature])} | ${rightFeature}=${String(asset[rightFeature])}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function buildBooleanConfusionMatrix(
  joinedAssets: JoinedAssetAnalysis[],
  actualFeature: keyof JoinedAssetAnalysis,
  predictedFeature: keyof JoinedAssetAnalysis,
): ConfusionMatrix {
  const matrix: ConfusionMatrix = {
    truePositive: 0,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
  };

  for (const asset of joinedAssets) {
    const actual = Boolean(asset[actualFeature]);
    const predicted = Boolean(asset[predictedFeature]);
    if (actual && predicted) matrix.truePositive += 1;
    else if (!actual && predicted) matrix.falsePositive += 1;
    else if (!actual && !predicted) matrix.trueNegative += 1;
    else matrix.falseNegative += 1;
  }

  return matrix;
}

function buildClassificationConfusionMatrix(
  joinedAssets: JoinedAssetAnalysis[],
  actualLabel: "embedded" | "cover",
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const asset of joinedAssets) {
    const actual =
      actualLabel === "embedded"
        ? asset.hasEmbedded
        : actualLabel === "cover"
          ? asset.hasCover
          : false;
    const key = `actual=${actual ? actualLabel : `not_${actualLabel}`} | predicted=${asset.heuristicFinalType}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function averageFeatureSet(joinedAssets: JoinedAssetAnalysis[]): NumericFeatureAverage {
  const featureTotals = {
    titleSimilarity: 0,
    parentSoundRecordingCount: 0,
    relatedSoundRecordingCount: 0,
    heuristicEmbeddedScore: 0,
    heuristicCoverScore: 0,
    heuristicConfidence: 0,
  };

  for (const asset of joinedAssets) {
    featureTotals.titleSimilarity += asset.titleSimilarity;
    featureTotals.parentSoundRecordingCount += asset.parentSoundRecordingCount;
    featureTotals.relatedSoundRecordingCount += asset.relatedSoundRecordingCount;
    featureTotals.heuristicEmbeddedScore += asset.heuristicEmbeddedScore;
    featureTotals.heuristicCoverScore += asset.heuristicCoverScore;
    featureTotals.heuristicConfidence += asset.heuristicConfidence;
  }

  const count = joinedAssets.length;
  return {
    count,
    averages: Object.fromEntries(
      Object.entries(featureTotals).map(([key, value]) => [key, count === 0 ? 0 : Number((value / count).toFixed(4))]),
    ),
  };
}

function summarizeSampledSubset(joinedAssets: JoinedAssetAnalysis[]): SampledSubsetSummary {
  const shapes: Record<string, number> = {};
  for (const asset of joinedAssets) {
    shapes[asset.shape] = (shapes[asset.shape] ?? 0) + 1;
  }

  return {
    totalAssets: joinedAssets.length,
    coverAssets: joinedAssets.filter((asset) => asset.hasCover).length,
    embeddedAssets: joinedAssets.filter((asset) => asset.hasEmbedded).length,
    shapes,
  };
}

function toCsvValue(value: unknown): string {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function writeDetailsCsv(outputPath: string, joinedAssets: JoinedAssetAnalysis[]): void {
  const headers = [
    "assetId",
    "customId",
    "title",
    "rowCount",
    "shape",
    "claimTypes",
    "rightTypes",
    "hasEmbedded",
    "hasCover",
    "selfType",
    "inRelationshipCache",
    "relatedAssetIds",
    "relatedTypes",
    "relatedSoundRecordingIds",
    "parentAssetIds",
    "childAssetIds",
    "parentSoundRecordingIds",
    "childSoundRecordingIds",
    "hasRelatedSoundRecording",
    "hasParentSoundRecording",
    "hasChildSoundRecording",
    "titleSimilarity",
    "customIdMatch",
    "parentSoundRecordingCount",
    "relatedSoundRecordingCount",
    "relatedAssetTypeCombo",
    "heuristicFinalType",
    "heuristicEmbeddedScore",
    "heuristicCoverScore",
    "heuristicConfidence",
    "heuristicReasons",
  ];

  const lines = [headers.join(",")];
  for (const asset of joinedAssets) {
    lines.push(
      [
        asset.assetId,
        asset.customId,
        asset.title,
        asset.rowCount,
        asset.shape,
        asset.claimTypes,
        asset.rightTypes,
        asset.hasEmbedded,
        asset.hasCover,
        asset.selfType,
        asset.inRelationshipCache,
        asset.relatedAssetIds,
        asset.relatedTypes,
        asset.relatedSoundRecordingIds,
        asset.parentAssetIds,
        asset.childAssetIds,
        asset.parentSoundRecordingIds,
        asset.childSoundRecordingIds,
        asset.hasRelatedSoundRecording,
        asset.hasParentSoundRecording,
        asset.hasChildSoundRecording,
        asset.titleSimilarity,
        asset.customIdMatch,
        asset.parentSoundRecordingCount,
        asset.relatedSoundRecordingCount,
        asset.relatedAssetTypeCombo,
        asset.heuristicFinalType,
        asset.heuristicEmbeddedScore,
        asset.heuristicCoverScore,
        asset.heuristicConfidence,
        asset.heuristicReasons,
      ].map(toCsvValue).join(","),
    );
  }

  fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
}

async function run(): Promise<void> {
  const samplePath = path.resolve(
    process.cwd(),
    parseArgValue("--samplePath=") ?? "저작/1.YouTube_kwangsoomedia_pla_M_20260101_20260131_rev_views_by_asset_v1-0.csv",
  );
  const relationshipCachePath = path.resolve(
    process.cwd(),
    parseArgValue("--relationshipCache=") ?? "asset_relationship_cache.json",
  );
  const outputJsonPath = path.resolve(
    process.cwd(),
    parseArgValue("--outputJson=") ?? "scratch/publishing_relationship_correlation.json",
  );
  const outputCsvPath = path.resolve(
    process.cwd(),
    parseArgValue("--outputCsv=") ?? "scratch/publishing_relationship_correlation_details.csv",
  );

  const sampleRows = await parseCsvRows(samplePath, { encoding: "auto" });
  const sampleSummaries = summarizeSampleRows(sampleRows);
  const relationshipCache = loadRelationshipCache(relationshipCachePath);
  const joinedAssets = sampleSummaries.map((summary) => analyzeJoinedAsset(summary, relationshipCache[summary.assetId]));

  const summary = summarizeCorrelation(joinedAssets);
  const cachedAssets = joinedAssets.filter((asset) => asset.inRelationshipCache);
  const pairCounts = {
    coverVsParentSoundRecording: buildPairCounts(joinedAssets, "hasCover", "hasParentSoundRecording"),
    embeddedVsParentSoundRecording: buildPairCounts(joinedAssets, "hasEmbedded", "hasParentSoundRecording"),
    coverVsRelatedSoundRecording: buildPairCounts(joinedAssets, "hasCover", "hasRelatedSoundRecording"),
    embeddedVsRelatedSoundRecording: buildPairCounts(joinedAssets, "hasEmbedded", "hasRelatedSoundRecording"),
  };
  const confusionMatrices = {
    embeddedByParentSoundRecording: buildBooleanConfusionMatrix(
      joinedAssets,
      "hasEmbedded",
      "hasParentSoundRecording",
    ),
    coverByParentSoundRecording: buildBooleanConfusionMatrix(
      joinedAssets,
      "hasCover",
      "hasParentSoundRecording",
    ),
    embeddedByRelatedSoundRecording: buildBooleanConfusionMatrix(
      joinedAssets,
      "hasEmbedded",
      "hasRelatedSoundRecording",
    ),
    coverByRelatedSoundRecording: buildBooleanConfusionMatrix(
      joinedAssets,
      "hasCover",
      "hasRelatedSoundRecording",
    ),
  };
  const sampledSubset = {
    summary: summarizeSampledSubset(cachedAssets),
    confusionMatrices: {
      embeddedByParentSoundRecording: buildBooleanConfusionMatrix(
        cachedAssets,
        "hasEmbedded",
        "hasParentSoundRecording",
      ),
      coverByParentSoundRecording: buildBooleanConfusionMatrix(
        cachedAssets,
        "hasCover",
        "hasParentSoundRecording",
      ),
      embeddedByRelatedSoundRecording: buildBooleanConfusionMatrix(
        cachedAssets,
        "hasEmbedded",
        "hasRelatedSoundRecording",
      ),
      coverByRelatedSoundRecording: buildBooleanConfusionMatrix(
        cachedAssets,
        "hasCover",
        "hasRelatedSoundRecording",
      ),
    },
    heuristicClassification: {
      embedded: buildClassificationConfusionMatrix(cachedAssets, "embedded"),
      cover: buildClassificationConfusionMatrix(cachedAssets, "cover"),
    },
    featureComparisons: {
      coverOnly: averageFeatureSet(cachedAssets.filter((asset) => asset.hasCover && !asset.hasEmbedded)),
      embeddedOnly: averageFeatureSet(cachedAssets.filter((asset) => asset.hasEmbedded && !asset.hasCover)),
      coverAndEmbedded: averageFeatureSet(cachedAssets.filter((asset) => asset.hasCover && asset.hasEmbedded)),
      falsePositivesEmbedded: averageFeatureSet(
        cachedAssets.filter((asset) => !asset.hasEmbedded && asset.heuristicFinalType === "embedded"),
      ),
      falseNegativesEmbedded: averageFeatureSet(
        cachedAssets.filter((asset) => asset.hasEmbedded && asset.heuristicFinalType !== "embedded"),
      ),
      falsePositivesCover: averageFeatureSet(
        cachedAssets.filter((asset) => !asset.hasCover && asset.heuristicFinalType === "cover"),
      ),
      falseNegativesCover: averageFeatureSet(
        cachedAssets.filter((asset) => asset.hasCover && asset.heuristicFinalType !== "cover"),
      ),
    },
  };

  const report = {
    samplePath,
    relationshipCachePath,
    summary,
    pairCounts,
    confusionMatrices,
    sampledSubset,
    topExamples: {
      coverWithParentSoundRecording: joinedAssets
        .filter((asset) => asset.hasCover && asset.hasParentSoundRecording)
        .slice(0, 20),
      coverWithoutParentSoundRecording: joinedAssets
        .filter((asset) => asset.hasCover && !asset.hasParentSoundRecording)
        .slice(0, 20),
      embeddedWithParentSoundRecording: joinedAssets
        .filter((asset) => asset.hasEmbedded && asset.hasParentSoundRecording)
        .slice(0, 20),
      embeddedWithoutParentSoundRecording: joinedAssets
        .filter((asset) => asset.hasEmbedded && !asset.hasParentSoundRecording)
        .slice(0, 20),
      falsePositivesEmbeddedByParent: joinedAssets
        .filter((asset) => !asset.hasEmbedded && asset.hasParentSoundRecording)
        .slice(0, 20),
      falseNegativesEmbeddedByParent: joinedAssets
        .filter((asset) => asset.hasEmbedded && !asset.hasParentSoundRecording)
        .slice(0, 20),
      falsePositivesCoverByParent: joinedAssets
        .filter((asset) => !asset.hasCover && asset.hasParentSoundRecording)
        .slice(0, 20),
      falseNegativesCoverByParent: joinedAssets
        .filter((asset) => asset.hasCover && !asset.hasParentSoundRecording)
        .slice(0, 20),
      heuristicFalsePositivesEmbedded: cachedAssets
        .filter((asset) => !asset.hasEmbedded && asset.heuristicFinalType === "embedded")
        .slice(0, 20),
      heuristicFalseNegativesEmbedded: cachedAssets
        .filter((asset) => asset.hasEmbedded && asset.heuristicFinalType !== "embedded")
        .slice(0, 20),
      heuristicFalsePositivesCover: cachedAssets
        .filter((asset) => !asset.hasCover && asset.heuristicFinalType === "cover")
        .slice(0, 20),
      heuristicFalseNegativesCover: cachedAssets
        .filter((asset) => asset.hasCover && asset.heuristicFinalType !== "cover")
        .slice(0, 20),
    },
  };

  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputCsvPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, JSON.stringify(report, null, 2), "utf-8");
  writeDetailsCsv(outputCsvPath, joinedAssets);

  console.log(`[AnalyzePublishingRelationshipCorrelation] sample assets=${summary.totalSampleAssets}`);
  console.log(`[AnalyzePublishingRelationshipCorrelation] cache hits=${summary.assetsInRelationshipCache}`);
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] cover assets=${summary.coverAssets} embedded assets=${summary.embeddedAssets}`,
  );
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] hasParentSoundRecording=true => ${summary.featureCounts.hasParentSoundRecording.true}`,
  );
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] embeddedByParentSoundRecording=${JSON.stringify(confusionMatrices.embeddedByParentSoundRecording)}`,
  );
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] coverByParentSoundRecording=${JSON.stringify(confusionMatrices.coverByParentSoundRecording)}`,
  );
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] sampledSubset=${JSON.stringify(sampledSubset.summary)}`,
  );
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] sampledEmbeddedByParent=${JSON.stringify(sampledSubset.confusionMatrices.embeddedByParentSoundRecording)}`,
  );
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] sampledCoverByParent=${JSON.stringify(sampledSubset.confusionMatrices.coverByParentSoundRecording)}`,
  );
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] sampledHeuristicEmbedded=${JSON.stringify(sampledSubset.heuristicClassification.embedded)}`,
  );
  console.log(
    `[AnalyzePublishingRelationshipCorrelation] sampledHeuristicCover=${JSON.stringify(sampledSubset.heuristicClassification.cover)}`,
  );
  console.log(`[AnalyzePublishingRelationshipCorrelation] wrote ${outputJsonPath}`);
  console.log(`[AnalyzePublishingRelationshipCorrelation] wrote ${outputCsvPath}`);
}

run().catch((error) => {
  console.error("[AnalyzePublishingRelationshipCorrelation] Failed.", error);
  process.exitCode = 1;
});
