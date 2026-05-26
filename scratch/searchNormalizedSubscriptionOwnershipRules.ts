import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

type Row = Record<string, string>;

interface Candidate {
  key: string;
  ownership: string;
  delta: number;
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
    const composite = `${customId}|${assetId}`;
    const matched = byCustomIdIsrc.get(composite);
    if (matched?.length === 1) return matched[0]!.assetId;
    const titleComposite = `${customId}|${title}`;
    const titleMatched = byCustomIdTitle.get(titleComposite);
    if (titleMatched?.length === 1) return titleMatched[0]!.assetId;
  }

  if (assetId) {
    const matched = byIsrc.get(assetId);
    if (matched?.length === 1) return matched[0]!.assetId;
  }
  if (title) {
    const matched = byIsrc.get(title);
    if (matched?.length === 1) return matched[0]!.assetId;
  }
  if (customId) {
    const matched = byCustomId.get(customId);
    if (matched?.length === 1) return matched[0]!.assetId;
  }
  if (title) {
    const matched = byTitle.get(title);
    if (matched?.length === 1) return matched[0]!.assetId;
  }

  return null;
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const cachePath = path.resolve(process.cwd(), process.argv[3] ?? "asset_metadata_cache_split.json");
  const targetDelta = Number(process.argv[4] ?? "273.122648698728");
  const ownershipCsv = process.argv[5] ?? "16.66,83.33,50,41.66,41.67";
  const minDelta = Number(process.argv[6] ?? "0.5");
  const tolerance = Number(process.argv[7] ?? "1");
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
  let resolvedRows = 0;
  let unresolvedRows = 0;
  for (const row of rows) {
    const ownership = clean(row["Ownership Percentage"]);
    if (!ownershipSet.has(ownership)) continue;
    const ownershipValue = toNumber(ownership);
    if (!ownershipValue) continue;
    const resolvedAssetId = resolveAssetId(row, metadataMap, byCustomId, byIsrc, byTitle, byCustomIdIsrc, byCustomIdTitle);
    if (!resolvedAssetId) {
      unresolvedRows += 1;
      continue;
    }
    resolvedRows += 1;
    const revenue = toNumber(row["Partner Revenue"]);
    const delta = revenue * (100 / ownershipValue - 1);
    const customId = clean(row["Custom ID"]);
    const title = clean(row["Asset Title"]);
    const key = `${ownership}|${resolvedAssetId}|${customId}|${title}`;
    const entry = byAsset.get(key) ?? { key, ownership, delta: 0 };
    entry.delta += delta;
    byAsset.set(key, entry);
  }

  const candidates = [...byAsset.values()].filter((entry) => entry.delta >= minDelta).sort((a, b) => b.delta - a.delta);
  const top = candidates.slice(0, 40);
  const results: Array<{ keys: string[]; total: number; diff: number }> = [];

  for (let i = 0; i < top.length; i += 1) {
    const c1 = top[i]!;
    const t1 = c1.delta;
    if (Math.abs(t1 - targetDelta) <= tolerance) results.push({ keys: [c1.key], total: t1, diff: Math.abs(t1 - targetDelta) });
    for (let j = i + 1; j < top.length; j += 1) {
      const c2 = top[j]!;
      const t2 = t1 + c2.delta;
      if (Math.abs(t2 - targetDelta) <= tolerance) results.push({ keys: [c1.key, c2.key], total: t2, diff: Math.abs(t2 - targetDelta) });
      for (let k = j + 1; k < top.length; k += 1) {
        const c3 = top[k]!;
        const t3 = t2 + c3.delta;
        if (Math.abs(t3 - targetDelta) <= tolerance) results.push({ keys: [c1.key, c2.key, c3.key], total: t3, diff: Math.abs(t3 - targetDelta) });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        targetDelta,
        ownerships: [...ownershipSet],
        resolvedRows,
        unresolvedRows,
        candidateCount: candidates.length,
        topCandidates: top.slice(0, 20),
        best: results.sort((a, b) => a.diff - b.diff).slice(0, 20),
      },
      null,
      2,
    ),
  );
}

run();
