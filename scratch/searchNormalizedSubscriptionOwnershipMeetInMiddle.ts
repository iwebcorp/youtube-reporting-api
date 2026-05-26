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
): string | null {
  const assetId = clean(row["Asset ID"]);
  const customId = clean(row["Custom ID"]);
  const title = clean(row["Asset Title"]);

  if (isValidAssetId(assetId)) return assetId;
  if (isValidAssetId(title) && metadataMap[title]) return title;

  if (customId && assetId) {
    const byIsrcComposite = byCustomIdIsrc.get(`${customId}|${assetId}`);
    if (byIsrcComposite?.length === 1) return byIsrcComposite[0]!.assetId;
    const byTitleComposite = byCustomIdTitle.get(`${customId}|${title}`);
    if (byTitleComposite?.length === 1) return byTitleComposite[0]!.assetId;
  }

  if (assetId) {
    const byAssetIdIsrc = byIsrc.get(assetId);
    if (byAssetIdIsrc?.length === 1) return byAssetIdIsrc[0]!.assetId;
  }
  if (title) {
    const byTitleIsrc = byIsrc.get(title);
    if (byTitleIsrc?.length === 1) return byTitleIsrc[0]!.assetId;
  }
  if (customId) {
    const byCustom = byCustomId.get(customId);
    if (byCustom?.length === 1) return byCustom[0]!.assetId;
  }
  if (title) {
    const byTitleOnly = byTitle.get(title);
    if (byTitleOnly?.length === 1) return byTitleOnly[0]!.assetId;
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

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const cachePath = path.resolve(process.cwd(), process.argv[3] ?? "asset_metadata_cache_split.json");
  const targetDelta = Number(process.argv[4] ?? "339.703243222355");
  const ownershipCsv = process.argv[5] ?? "16.66,83.33,50,41.66,41.67";
  const minDelta = Number(process.argv[6] ?? "0.5");
  const topN = Number(process.argv[7] ?? "32");
  const tolerance = Number(process.argv[8] ?? "0.1");
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
  for (const row of rows) {
    const ownership = clean(row["Ownership Percentage"]);
    if (!ownershipSet.has(ownership)) continue;
    const ownershipValue = toNumber(ownership);
    if (!ownershipValue) continue;
    const resolvedAssetId = resolveAssetId(row, metadataMap, byCustomId, byIsrc, byTitle, byCustomIdIsrc, byCustomIdTitle);
    if (!resolvedAssetId) continue;
    const revenue = toNumber(row["Partner Revenue"]);
    const delta = revenue * (100 / ownershipValue - 1);
    const customId = clean(row["Custom ID"]);
    const title = clean(row["Asset Title"]);
    const key = `${ownership}|${resolvedAssetId}|${customId}|${title}`;
    const entry = byAsset.get(key) ?? { key, delta: 0 };
    entry.delta += delta;
    byAsset.set(key, entry);
  }

  const candidates = [...byAsset.values()].filter((entry) => entry.delta >= minDelta).sort((a, b) => b.delta - a.delta).slice(0, topN);
  const midpoint = Math.ceil(candidates.length / 2);
  const left = candidates.slice(0, midpoint);
  const right = candidates.slice(midpoint);
  const leftSubsets = enumerateSubsets(left);
  const rightSubsets = enumerateSubsets(right);

  const results: Array<{ total: number; diff: number; keys: string[] }> = [];
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
      results.push({
        total,
        diff,
        keys: [
          ...resolveKeys(left, leftSubset.indexes),
          ...resolveKeys(right, rightSubset.indexes),
        ],
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        targetDelta,
        ownerships: [...ownershipSet],
        minDelta,
        topN,
        candidateCount: candidates.length,
        topCandidates: candidates.slice(0, 20),
        best: results.sort((a, b) => a.diff - b.diff).slice(0, 20),
      },
      null,
      2,
    ),
  );
}

run();
