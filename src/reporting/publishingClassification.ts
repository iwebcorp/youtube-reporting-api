import { clean } from "./utils.js";

export interface AssetRelationshipItem {
  parentAssetId?: string;
  childAssetId?: string;
  [key: string]: unknown;
}

export interface AssetRelationshipCacheEntry {
  assetId: string;
  relatedAssetIds?: string[];
  assetMetadata?: Record<string, Record<string, unknown>>;
  allRelations?: AssetRelationshipItem[];
}

export interface PublishingClassificationContext {
  assetId: string;
  title?: string;
  customId?: string;
  claimTypes?: string[];
  rightTypes?: string[];
}

export interface PublishingClassificationFeatures {
  selfType: string;
  parentSoundRecordingCount: number;
  relatedSoundRecordingCount: number;
  parentAssetCount: number;
  relatedAssetTypeCombo: string;
  titleSimilarity: number;
  customIdMatch: boolean;
  hasISRC: boolean;
  rightTypeCombo: string;
  claimTypeCombo: string;
}

export interface PublishingClassificationResult {
  assetId: string;
  finalType: "embedded" | "cover" | "mixed" | "unknown";
  embeddedScore: number;
  coverScore: number;
  confidence: number;
  reasons: string[];
  features: PublishingClassificationFeatures;
}

function tokenize(value: string): string[] {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function classifyEmbeddedCover(
  context: PublishingClassificationContext,
  relationshipEntry: AssetRelationshipCacheEntry | undefined,
): PublishingClassificationResult {
  if (!relationshipEntry) {
    return {
      assetId: context.assetId,
      finalType: "unknown",
      embeddedScore: 0,
      coverScore: 0,
      confidence: 0,
      reasons: ["missing_relationship_entry"],
      features: {
        selfType: "",
        parentSoundRecordingCount: 0,
        relatedSoundRecordingCount: 0,
        parentAssetCount: 0,
        relatedAssetTypeCombo: "",
        titleSimilarity: 0,
        customIdMatch: false,
        hasISRC: false,
        rightTypeCombo: (context.rightTypes ?? []).join("+"),
        claimTypeCombo: (context.claimTypes ?? []).join("+"),
      },
    };
  }

  const assetMetadata = relationshipEntry.assetMetadata ?? {};
  const selfMetadata = assetMetadata[context.assetId] ?? {};
  const selfType = clean(selfMetadata["type"]);
  const relatedAssetIds = (relationshipEntry.relatedAssetIds ?? []).map((value) => clean(value)).filter(Boolean);
  const allRelations = relationshipEntry.allRelations ?? [];
  const parentAssetIds = Array.from(
    new Set(allRelations.map((relation) => clean(relation.parentAssetId)).filter(Boolean)),
  );

  const relatedSoundRecordingIds = relatedAssetIds.filter(
    (assetId) => clean(assetMetadata[assetId]?.["type"]) === "sound_recording",
  );
  const parentSoundRecordingIds = parentAssetIds.filter(
    (assetId) => clean(assetMetadata[assetId]?.["type"]) === "sound_recording",
  );
  const relatedAssetTypeCombo = Array.from(
    new Set(relatedAssetIds.map((assetId) => clean(assetMetadata[assetId]?.["type"])).filter(Boolean)),
  )
    .sort()
    .join("+");

  const sourceTitle = clean(context.title);
  const sourceCustomId = clean(context.customId);
  const titleSimilarity = relatedAssetIds.reduce((best, assetId) => {
    const relatedTitle = clean(assetMetadata[assetId]?.["title"]);
    return Math.max(best, jaccardSimilarity(sourceTitle, relatedTitle));
  }, 0);
  const customIdMatch = relatedAssetIds.some((assetId) => clean(assetMetadata[assetId]?.["customId"]) === sourceCustomId && sourceCustomId !== "");
  const hasISRC =
    clean(selfMetadata["isrc"]) !== "" ||
    relatedAssetIds.some((assetId) => clean(assetMetadata[assetId]?.["isrc"]) !== "");
  const rightTypeCombo = (context.rightTypes ?? []).join("+");
  const claimTypeCombo = (context.claimTypes ?? []).join("+");

  const features: PublishingClassificationFeatures = {
    selfType,
    parentSoundRecordingCount: parentSoundRecordingIds.length,
    relatedSoundRecordingCount: relatedSoundRecordingIds.length,
    parentAssetCount: parentAssetIds.length,
    relatedAssetTypeCombo,
    titleSimilarity,
    customIdMatch,
    hasISRC,
    rightTypeCombo,
    claimTypeCombo,
  };

  const reasons: string[] = [];
  let embeddedScore = 0;
  let coverScore = 0;

  if (selfType === "composition") {
    embeddedScore += 0.1;
    reasons.push("self_type=composition");
  }

  if (features.parentSoundRecordingCount >= 2) {
    embeddedScore += 0.2;
    reasons.push(`parent_sound_recording_count=${features.parentSoundRecordingCount}`);
  } else if (features.parentSoundRecordingCount === 1) {
    embeddedScore += 0.08;
    reasons.push("single_parent_sound_recording");
  } else {
    coverScore += 0.2;
    reasons.push("no_parent_sound_recording");
  }

  if (features.relatedSoundRecordingCount === 0) {
    coverScore += 0.25;
    reasons.push("no_related_sound_recording");
  } else if (features.relatedSoundRecordingCount >= 2) {
    embeddedScore += 0.12;
    reasons.push(`related_sound_recording_count=${features.relatedSoundRecordingCount}`);
  }

  if (features.titleSimilarity >= 0.85) {
    embeddedScore += 0.22;
    reasons.push(`high_title_similarity=${features.titleSimilarity.toFixed(2)}`);
  } else if (features.titleSimilarity <= 0.4) {
    coverScore += 0.18;
    reasons.push(`low_title_similarity=${features.titleSimilarity.toFixed(2)}`);
  }

  if (features.customIdMatch) {
    embeddedScore += 0.1;
    reasons.push("custom_id_match");
  }

  if (features.relatedAssetTypeCombo.includes("sound_recording")) {
    embeddedScore += 0.08;
    reasons.push(`related_asset_types=${features.relatedAssetTypeCombo}`);
  }

  if (features.claimTypeCombo === "Cover") {
    coverScore += 0.35;
    reasons.push("claim_type_cover_only");
  } else if (features.claimTypeCombo === "Embedded") {
    embeddedScore += 0.3;
    reasons.push("claim_type_embedded_only");
  } else if (features.claimTypeCombo.includes("Cover") && features.claimTypeCombo.includes("Embedded")) {
    embeddedScore += 0.08;
    coverScore += 0.08;
    reasons.push("claim_type_mixed");
  }

  if (features.rightTypeCombo === "Mechanical") {
    coverScore += 0.05;
    reasons.push("right_type_mechanical_only");
  } else if (features.rightTypeCombo === "Mechanical+Performance") {
    embeddedScore += 0.05;
    reasons.push("right_type_mechanical_performance");
  }

  if (!features.hasISRC) {
    coverScore += 0.05;
    reasons.push("missing_isrc");
  }

  embeddedScore = clamp(embeddedScore);
  coverScore = clamp(coverScore);
  const scoreGap = embeddedScore - coverScore;

  let finalType: PublishingClassificationResult["finalType"] = "unknown";
  if (scoreGap >= 0.2) {
    finalType = "embedded";
  } else if (scoreGap <= -0.2) {
    finalType = "cover";
  } else if (embeddedScore > 0 || coverScore > 0) {
    finalType = "mixed";
  }

  return {
    assetId: context.assetId,
    finalType,
    embeddedScore: Number(embeddedScore.toFixed(4)),
    coverScore: Number(coverScore.toFixed(4)),
    confidence: Number(clamp(Math.abs(scoreGap) * 1.6).toFixed(4)),
    reasons,
    features,
  };
}
