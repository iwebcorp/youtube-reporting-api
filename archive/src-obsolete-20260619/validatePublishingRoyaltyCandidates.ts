import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type { AssetMetadata } from "./reporting/types.js";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

type Row = Record<string, string>;

export interface CandidateRulesFile {
  yearMonth: string;
  adjustment: {
    actual?: number;
    source?: string;
    details?: string[];
    upscaleAssetIds?: string[];
    dropAssetIds?: string[];
    alternatives?: Array<{ name: string; dropAssetIds: string[] }>;
  };
  subscription: {
    exclusionKeys: string[];
  };
}

export interface PublishingRoyaltyTargetsFile {
  yearMonth: string;
  targets: {
    publishing_daily_ad: number;
    publishing_daily_ad_adj: number;
    publishing_monthly_sub: number;
    publishing_ddex_dsr: number;
    publishing_total: number;
  };
}

interface AdjustmentAssetEntry {
  assetId: string;
  baseRevenue: number;
  ownership: string;
  upscaleDelta: number;
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function toNumber(value: string | undefined): number {
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isValidAssetId(value: string): boolean {
  return /^A\d+$/.test(clean(value));
}

export function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function loadSharedStrings(sharedStringsXml: string): string[] {
  return Array.from(sharedStringsXml.matchAll(/<t[^>]*>(.*?)<\/t>/gs), (match) =>
    (match[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

function parseWorksheet(sheetXml: string, sharedStrings: string[]): Row[] {
  const rowMatches = Array.from(sheetXml.matchAll(/<row r="(\d+)"[^>]*>(.*?)<\/row>/gs));
  const parseRow = (rowXml: string): Map<string, string> => {
    const values = new Map<string, string>();
    for (const cell of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>(.*?)<\/v>)?.*?<\/c>/gs)) {
      const column = cell[1] ?? "";
      const attrs = cell[2] ?? "";
      const rawValue = cell[3] ?? "";
      const sharedMatch = attrs.match(/\bt="([^"]+)"/);
      const resolved =
        sharedMatch?.[1] === "s" && /^\d+$/.test(rawValue)
          ? (sharedStrings[Number(rawValue)] ?? "")
          : rawValue;
      values.set(column, resolved);
    }
    return values;
  };

  const headerRowIndex = rowMatches.findIndex((rowMatch) => {
    const cellMap = parseRow(rowMatch[2] ?? "");
    return Array.from(cellMap.values()).includes("Asset ID");
  });
  if (headerRowIndex < 0) {
    return [];
  }

  const headerCells = parseRow(rowMatches[headerRowIndex]?.[2] ?? "");
  const headerOrder = Array.from(headerCells.keys());
  const headers = headerOrder.map((column) => headerCells.get(column) ?? "");
  const rows: Row[] = [];
  for (const rowMatch of rowMatches.slice(headerRowIndex + 1)) {
    const cellMap = parseRow(rowMatch[2] ?? "");
    const row: Row = {};
    for (let index = 0; index < headerOrder.length; index += 1) {
      const header = headers[index] ?? "";
      const column = headerOrder[index] ?? "";
      if (header) {
        row[header] = cellMap.get(column) ?? "";
      }
    }
    rows.push(row);
  }
  return rows;
}

export function readProbeRows(probeDir: string): Row[] {
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  return parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
}

function collectOwnerships(rows: Row[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const assetId = clean(row["Asset ID"]);
    const ownership = clean(row["Ownership Percentage"]);
    if (!assetId || !ownership) {
      continue;
    }
    const bucket = map.get(assetId) ?? new Set<string>();
    bucket.add(ownership);
    map.set(assetId, bucket);
  }
  return map;
}

function buildIndex(records: AssetMetadata[], picker: (record: AssetMetadata) => string): Map<string, AssetMetadata[]> {
  const index = new Map<string, AssetMetadata[]>();
  for (const record of records) {
    const key = clean(picker(record));
    if (!key) {
      continue;
    }
    const bucket = index.get(key) ?? [];
    bucket.push(record);
    index.set(key, bucket);
  }
  return index;
}

function buildCompositeIndex(
  records: AssetMetadata[],
  pickerA: (record: AssetMetadata) => string,
  pickerB: (record: AssetMetadata) => string,
): Map<string, AssetMetadata[]> {
  const index = new Map<string, AssetMetadata[]>();
  for (const record of records) {
    const a = clean(pickerA(record));
    const b = clean(pickerB(record));
    if (!a || !b) {
      continue;
    }
    const composite = `${a}|${b}`;
    const bucket = index.get(composite) ?? [];
    bucket.push(record);
    index.set(composite, bucket);
  }
  return index;
}

function resolveSubscriptionAssetId(
  row: Row,
  metadataMap: Record<string, AssetMetadata>,
  byCustomId: Map<string, AssetMetadata[]>,
  byIsrc: Map<string, AssetMetadata[]>,
  byTitle: Map<string, AssetMetadata[]>,
  byCustomIdIsrc: Map<string, AssetMetadata[]>,
  byCustomIdTitle: Map<string, AssetMetadata[]>,
): string | null {
  const assetId = clean(row["Asset ID"]);
  const customId = clean(row["Custom ID"]);
  const title = clean(row["Asset Title"]);

  if (isValidAssetId(assetId)) {
    return assetId;
  }
  if (isValidAssetId(title) && metadataMap[title]) {
    return title;
  }
  if (customId && assetId) {
    const isrcComposite = byCustomIdIsrc.get(`${customId}|${assetId}`);
    if (isrcComposite?.length === 1) {
      return isrcComposite[0]!.assetId;
    }
    const titleComposite = byCustomIdTitle.get(`${customId}|${title}`);
    if (titleComposite?.length === 1) {
      return titleComposite[0]!.assetId;
    }
  }
  if (assetId) {
    const isrcMatch = byIsrc.get(assetId);
    if (isrcMatch?.length === 1) {
      return isrcMatch[0]!.assetId;
    }
  }
  if (title) {
    const titleIsrcMatch = byIsrc.get(title);
    if (titleIsrcMatch?.length === 1) {
      return titleIsrcMatch[0]!.assetId;
    }
  }
  if (customId) {
    const customMatch = byCustomId.get(customId);
    if (customMatch?.length === 1) {
      return customMatch[0]!.assetId;
    }
  }
  if (title) {
    const titleMatch = byTitle.get(title);
    if (titleMatch?.length === 1) {
      return titleMatch[0]!.assetId;
    }
  }

  return null;
}

export function evaluateAdjustmentCandidate(
  rules: CandidateRulesFile["adjustment"],
  adProbeRows: Row[],
  adOwnershipRows: Row[],
  subOwnershipRows: Row[],
): {
  baseTotal: number;
  selectedTotal: number;
  alternatives: Array<{ name: string; selectedTotal: number }>;
} {
  const adOwnerships = collectOwnerships(adOwnershipRows);
  const subOwnerships = collectOwnerships(subOwnershipRows);
  const byAsset = new Map<string, AdjustmentAssetEntry>();

  for (const row of adProbeRows) {
    const assetId = clean(row["Asset ID"]);
    const revenue = toNumber(row["Partner Revenue"]);
    const ownership =
      [...(adOwnerships.get(assetId) ?? new Set<string>())][0] ??
      [...(subOwnerships.get(assetId) ?? new Set<string>())][0] ??
      "";
    const ownershipValue = Number(ownership);
    const upscaleDelta =
      Number.isFinite(ownershipValue) && ownershipValue > 0 && ownershipValue !== 100
        ? revenue * (100 / ownershipValue - 1)
        : 0;

    const current = byAsset.get(assetId) ?? { assetId, baseRevenue: 0, ownership, upscaleDelta: 0 };
    current.baseRevenue += revenue;
    current.upscaleDelta += upscaleDelta;
    if (!current.ownership) {
      current.ownership = ownership;
    }
    byAsset.set(assetId, current);
  }

  const baseTotal = [...byAsset.values()].reduce((sum, entry) => sum + entry.baseRevenue, 0);
  const upscaleAssetIds = rules.upscaleAssetIds ?? [];
  const dropAssetIds = rules.dropAssetIds ?? [];
  const selectedTotal =
    baseTotal +
    upscaleAssetIds.reduce((sum, assetId) => sum + (byAsset.get(assetId)?.upscaleDelta ?? 0), 0) -
    dropAssetIds.reduce((sum, assetId) => sum + (byAsset.get(assetId)?.baseRevenue ?? 0), 0);

  const alternatives =
    rules.alternatives?.map((alternative) => ({
      name: alternative.name,
        selectedTotal:
          baseTotal +
          upscaleAssetIds.reduce((sum, assetId) => sum + (byAsset.get(assetId)?.upscaleDelta ?? 0), 0) -
          alternative.dropAssetIds.reduce((sum, assetId) => sum + (byAsset.get(assetId)?.baseRevenue ?? 0), 0),
    })) ?? [];

  return { baseTotal, selectedTotal, alternatives };
}

function evaluateSubscriptionCandidate(
  exclusionKeys: string[],
  subscriptionRows: Row[],
  metadataMap: Record<string, AssetMetadata>,
): {
  normalizedTotal: number;
  upscaledNormalizedTotal: number;
  selectedTotal: number;
  unresolvedRows: number;
} {
  const records = Object.values(metadataMap).filter((record) => record.sourceCategory === "Publishing");
  const byCustomId = buildIndex(records, (record) => record.customId);
  const byIsrc = buildIndex(records, (record) => record.isrc);
  const byTitle = buildIndex(records, (record) => record.title);
  const byCustomIdIsrc = buildCompositeIndex(records, (record) => record.customId, (record) => record.isrc);
  const byCustomIdTitle = buildCompositeIndex(records, (record) => record.customId, (record) => record.title);

  const exclusionKeySet = new Set(exclusionKeys);
  let normalizedTotal = 0;
  let upscaledNormalizedTotal = 0;
  let unresolvedRows = 0;
  let exclusionDelta = 0;

  for (const row of subscriptionRows) {
    const resolvedAssetId = resolveSubscriptionAssetId(
      row,
      metadataMap,
      byCustomId,
      byIsrc,
      byTitle,
      byCustomIdIsrc,
      byCustomIdTitle,
    );
    if (!resolvedAssetId) {
      unresolvedRows += 1;
      continue;
    }

    const revenue = toNumber(row["Partner Revenue"]);
    const ownership = toNumber(row["Ownership Percentage"]);
    const customId = clean(row["Custom ID"]);
    const title = clean(row["Asset Title"]);
    const key = `${clean(row["Ownership Percentage"])}|${resolvedAssetId}|${customId}|${title}`;

    normalizedTotal += revenue;
    const upscaledRevenue = ownership > 0 ? revenue * (100 / ownership) : revenue;
    upscaledNormalizedTotal += upscaledRevenue;

    if (ownership > 0 && ownership !== 100 && exclusionKeySet.has(key)) {
      exclusionDelta += upscaledRevenue - revenue;
    }
  }

  return {
    normalizedTotal,
    upscaledNormalizedTotal,
    selectedTotal: upscaledNormalizedTotal - exclusionDelta,
    unresolvedRows,
  };
}

export async function runPublishingRoyaltyCandidateValidation(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const rulesPath = path.resolve(process.cwd(), `publishing_royalty_${config.yearMonth}_candidate_rules.json`);
  const targetsPath = path.resolve(process.cwd(), `publishing_royalty_${config.yearMonth}_targets.json`);
  const metadataPath = path.resolve(process.cwd(), "asset_metadata_cache_split.json");

  const rules = loadJson<CandidateRulesFile>(rulesPath);
  const targets = loadJson<PublishingRoyaltyTargetsFile>(targetsPath);
  const metadataMap = loadJson<Record<string, AssetMetadata>>(metadataPath);

  const adjustmentProbeRows = readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/ad_pub_adj"));
  const adOwnershipRows = readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/ad_pub_26_3"));
  const subOwnershipRows = readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/red_pub_26_3"));
  const subscriptionRows = subOwnershipRows;

  const adjustment = evaluateAdjustmentCandidate(rules.adjustment, adjustmentProbeRows, adOwnershipRows, subOwnershipRows);
  const subscription = evaluateSubscriptionCandidate(rules.subscription.exclusionKeys, subscriptionRows, metadataMap);

  const adjustmentTarget = targets.targets.publishing_daily_ad_adj;
  const subscriptionTarget = targets.targets.publishing_monthly_sub;

  console.log("[ValidatePublishingRoyaltyCandidates] 202604 candidate comparison");
  console.log(
    `- adjustment: actual=${adjustment.selectedTotal.toFixed(12)} | target=${adjustmentTarget.toFixed(12)} | diff=${(adjustment.selectedTotal - adjustmentTarget).toFixed(12)}`,
  );
  console.log(`  baseTotal=${adjustment.baseTotal.toFixed(12)}`);
  for (const alternative of adjustment.alternatives) {
    console.log(
      `  alternative:${alternative.name}=${alternative.selectedTotal.toFixed(12)} | diff=${(alternative.selectedTotal - adjustmentTarget).toFixed(12)}`,
    );
  }
  console.log(
    `- subscription: actual=${subscription.selectedTotal.toFixed(12)} | target=${subscriptionTarget.toFixed(12)} | diff=${(subscription.selectedTotal - subscriptionTarget).toFixed(12)}`,
  );
  console.log(`  normalizedTotal=${subscription.normalizedTotal.toFixed(12)}`);
  console.log(`  upscaledNormalizedTotal=${subscription.upscaledNormalizedTotal.toFixed(12)}`);
  console.log(`  unresolvedRows=${subscription.unresolvedRows}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPublishingRoyaltyCandidateValidation().catch((error) => {
    console.error("[ValidatePublishingRoyaltyCandidates] Validation failed.", error);
    process.exitCode = 1;
  });
}
