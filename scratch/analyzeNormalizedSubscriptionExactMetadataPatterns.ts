import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

type Row = Record<string, string>;

interface Candidate {
  key: string;
  delta: number;
}

interface SubsetEntry {
  total: number;
  indexes: number[];
}

interface ExactResult {
  total: number;
  diff: number;
  keys: string[];
}

interface ResolvedAsset {
  assetId: string;
  strategy: string;
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
  if (headerRowIndex < 0) return [];

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
      if (header) row[header] = cellMap.get(column) ?? "";
    }
    rows.push(row);
  }
  return rows;
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

function buildIndex(records: AssetMetadata[], picker: (record: AssetMetadata) => string): Map<string, AssetMetadata[]> {
  const index = new Map<string, AssetMetadata[]>();
  for (const record of records) {
    const key = clean(picker(record));
    if (!key) continue;
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
    if (!a || !b) continue;
    const composite = `${a}|${b}`;
    const bucket = index.get(composite) ?? [];
    bucket.push(record);
    index.set(composite, bucket);
  }
  return index;
}

function resolveAssetId(
  row: Row,
  metadataMap: Record<string, AssetMetadata>,
  byCustomId: Map<string, AssetMetadata[]>,
  byIsrc: Map<string, AssetMetadata[]>,
  byTitle: Map<string, AssetMetadata[]>,
  byCustomIdIsrc: Map<string, AssetMetadata[]>,
  byCustomIdTitle: Map<string, AssetMetadata[]>,
): ResolvedAsset | null {
  const assetId = clean(row["Asset ID"]);
  const customId = clean(row["Custom ID"]);
  const title = clean(row["Asset Title"]);

  if (isValidAssetId(assetId)) return { assetId, strategy: "asset_id_valid" };
  if (isValidAssetId(title) && metadataMap[title]) return { assetId: title, strategy: "title_has_asset_id" };

  if (customId && assetId) {
    const byIsrcComposite = byCustomIdIsrc.get(`${customId}|${assetId}`);
    if (byIsrcComposite?.length === 1) return { assetId: byIsrcComposite[0]!.assetId, strategy: "custom_id_plus_assetid_isrc" };
    const byTitleComposite = byCustomIdTitle.get(`${customId}|${title}`);
    if (byTitleComposite?.length === 1) return { assetId: byTitleComposite[0]!.assetId, strategy: "custom_id_plus_title" };
  }

  if (assetId) {
    const byAssetIdIsrc = byIsrc.get(assetId);
    if (byAssetIdIsrc?.length === 1) return { assetId: byAssetIdIsrc[0]!.assetId, strategy: "assetid_isrc" };
  }
  if (title) {
    const byTitleIsrc = byIsrc.get(title);
    if (byTitleIsrc?.length === 1) return { assetId: byTitleIsrc[0]!.assetId, strategy: "title_isrc" };
  }
  if (customId) {
    const byCustom = byCustomId.get(customId);
    if (byCustom?.length === 1) return { assetId: byCustom[0]!.assetId, strategy: "custom_id_unique" };
  }
  if (title) {
    const byTitleOnly = byTitle.get(title);
    if (byTitleOnly?.length === 1) return { assetId: byTitleOnly[0]!.assetId, strategy: "title_unique" };
  }

  return null;
}

function enumerateSubsets(candidates: Candidate[]): SubsetEntry[] {
  const result: SubsetEntry[] = [];
  const subsetCount = 1 << candidates.length;
  for (let mask = 0; mask < subsetCount; mask += 1) {
    let total = 0;
    const indexes: number[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      total += candidates[index]!.delta;
      indexes.push(index);
    }
    result.push({ total, indexes });
  }
  return result.sort((a, b) => a.total - b.total);
}

function resolveKeys(candidates: Candidate[], indexes: number[]): string[] {
  return indexes.map((index) => candidates[index]!.key);
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
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
  if (normalized.includes("official")) features.push("official");
  if (normalized.includes("live")) features.push("live");
  if (normalized.includes("inst")) features.push("inst");
  if (normalized.includes("mr")) features.push("mr");
  if (normalized.includes("lyric")) features.push("lyric");
  if (normalized.includes("worship")) features.push("worship");
  if (normalized.includes("streaming")) features.push("streaming");
  if (normalized.includes("예배")) features.push("worship_service");
  if (normalized.includes("캠프")) features.push("camp");
  if (normalized.includes("찬송가")) features.push("hymn");
  if (normalized.includes("마커스")) features.push("markers");
  if (normalized.includes("어노인팅")) features.push("anointing");
  if (normalized.includes("예람")) features.push("yeram");
  return features;
}

function keySummary(key: string) {
  const [ownership, assetId, customId, title] = key.split("|");
  return { ownership, assetId, customId, title };
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const cachePath = path.resolve(process.cwd(), process.argv[3] ?? "asset_metadata_cache_split.json");
  const targetDelta = Number(process.argv[4] ?? "40.554572976535");
  const ownershipCsv = process.argv[5] ?? "50,41.66,16.66,83.33,20.83,58.33,16.67,8.33,66.66,74.4,41.67";
  const minDelta = Number(process.argv[6] ?? "0.1");
  const topN = Number(process.argv[7] ?? "44");
  const tolerance = Number(process.argv[8] ?? "0.000001");
  const limit = Number(process.argv[9] ?? "30");
  const minOccurrences = Number(process.argv[10] ?? "10");
  const ownershipSet = new Set(ownershipCsv.split(",").map((value) => value.trim()).filter(Boolean));

  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
  const metadataMap = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetMetadata>;
  const records = Object.values(metadataMap).filter((record) => record.sourceCategory === "Publishing");

  const byCustomId = buildIndex(records, (record) => record.customId);
  const byIsrc = buildIndex(records, (record) => record.isrc);
  const byTitle = buildIndex(records, (record) => record.title);
  const byCustomIdIsrc = buildCompositeIndex(records, (record) => record.customId, (record) => record.isrc);
  const byCustomIdTitle = buildCompositeIndex(records, (record) => record.customId, (record) => record.title);

  const byAsset = new Map<string, Candidate>();
  const strategyByKey = new Map<string, string>();
  for (const row of rows) {
    const ownership = clean(row["Ownership Percentage"]);
    if (!ownershipSet.has(ownership)) continue;
    const ownershipValue = toNumber(ownership);
    if (!ownershipValue) continue;
    const resolved = resolveAssetId(row, metadataMap, byCustomId, byIsrc, byTitle, byCustomIdIsrc, byCustomIdTitle);
    if (!resolved) continue;
    const revenue = toNumber(row["Partner Revenue"]);
    const delta = revenue * (100 / ownershipValue - 1);
    const customId = clean(row["Custom ID"]);
    const title = clean(row["Asset Title"]);
    const key = `${ownership}|${resolved.assetId}|${customId}|${title}`;
    const entry = byAsset.get(key) ?? { key, delta: 0 };
    entry.delta += delta;
    byAsset.set(key, entry);
    if (!strategyByKey.has(key)) strategyByKey.set(key, resolved.strategy);
  }

  const candidates = [...byAsset.values()]
    .filter((entry) => entry.delta >= minDelta)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, topN);

  const midpoint = Math.ceil(candidates.length / 2);
  const left = candidates.slice(0, midpoint);
  const right = candidates.slice(midpoint);
  const leftSubsets = enumerateSubsets(left);
  const rightSubsets = enumerateSubsets(right);

  const exactResults: ExactResult[] = [];
  let rightIndex = rightSubsets.length - 1;
  for (const leftSubset of leftSubsets) {
    while (rightIndex > 0 && leftSubset.total + rightSubsets[rightIndex]!.total > targetDelta) {
      rightIndex -= 1;
    }
    for (const candidateIndex of [rightIndex, rightIndex + 1]) {
      const rightSubset = rightSubsets[candidateIndex];
      if (!rightSubset) continue;
      const total = leftSubset.total + rightSubset.total;
      const diff = Math.abs(total - targetDelta);
      if (diff > tolerance) continue;
      exactResults.push({
        total,
        diff,
        keys: [
          ...resolveKeys(left, leftSubset.indexes),
          ...resolveKeys(right, rightSubset.indexes),
        ],
      });
    }
  }

  const best = exactResults.sort((a, b) => a.diff - b.diff).slice(0, limit);
  const keyCounts = new Map<string, number>();
  for (const result of best) {
    for (const key of result.keys) increment(keyCounts, key);
  }

  const repeated = [...keyCounts.entries()]
    .filter(([, count]) => count >= minOccurrences)
    .sort((a, b) => b[1] - a[1]);

  const ownershipCounts = new Map<string, number>();
  const writerCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();
  const titleFeatureCounts = new Map<string, number>();
  const customPrefixCounts = new Map<string, number>();
  const assetTypeCounts = new Map<string, number>();
  const claimTypeCounts = new Map<string, number>();
  const rightTypeCounts = new Map<string, number>();
  const channelCounts = new Map<string, number>();
  const strategyCounts = new Map<string, number>();

  const assets = repeated.map(([key, count]) => {
    const { ownership, assetId, customId, title } = keySummary(key);
    const metadata = metadataMap[assetId];
    const strategy = strategyByKey.get(key) ?? "";
    increment(ownershipCounts, ownership, count);
    increment(customPrefixCounts, customId.slice(0, 3), count);
    increment(assetTypeCounts, clean(metadata?.assetType), count);
    increment(claimTypeCounts, clean(metadata?.musicClaimType), count);
    increment(rightTypeCounts, clean(metadata?.compositionRightType), count);
    increment(channelCounts, clean(metadata?.channelId), count);
    increment(strategyCounts, strategy, count);
    for (const writer of splitTerms(metadata?.writers ?? "")) increment(writerCounts, writer, count);
    for (const artist of splitTerms(metadata?.artist ?? "")) increment(artistCounts, artist, count);
    for (const feature of classifyTitleFeatures(title || metadata?.title || "")) {
      increment(titleFeatureCounts, feature, count);
    }
    return {
      count,
      ownership,
      assetId,
      customId,
      title,
      metadataTitle: metadata?.title ?? "",
      writers: metadata?.writers ?? "",
      artist: metadata?.artist ?? "",
      assetType: metadata?.assetType ?? "",
      musicClaimType: metadata?.musicClaimType ?? "",
      compositionRightType: metadata?.compositionRightType ?? "",
      channelId: metadata?.channelId ?? "",
      strategy,
    };
  });

  const summarize = (map: Map<string, number>, slice = 20) =>
    [...map.entries()]
      .filter(([key]) => key)
      .sort((a, b) => b[1] - a[1])
      .slice(0, slice)
      .map(([key, count]) => ({ key, count }));

  console.log(
    JSON.stringify(
      {
        targetDelta,
        exactCount: best.length,
        minOccurrences,
        repeatedAssetCount: assets.length,
        repeatedOwnerships: summarize(ownershipCounts),
        repeatedCustomPrefixes: summarize(customPrefixCounts),
        repeatedTitleFeatures: summarize(titleFeatureCounts),
        repeatedWriters: summarize(writerCounts, 30),
        repeatedArtists: summarize(artistCounts, 30),
        repeatedAssetTypes: summarize(assetTypeCounts),
        repeatedClaimTypes: summarize(claimTypeCounts),
        repeatedRightTypes: summarize(rightTypeCounts),
        repeatedChannels: summarize(channelCounts, 10),
        repeatedStrategies: summarize(strategyCounts),
        repeatedAssets: assets,
      },
      null,
      2,
    ),
  );
}

run();
