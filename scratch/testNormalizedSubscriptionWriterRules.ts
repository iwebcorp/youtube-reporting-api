import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

type Row = Record<string, string>;

interface ResolvedAsset {
  assetId: string;
  strategy: string;
}

interface CandidateRow {
  ownership: string;
  assetId: string;
  customId: string;
  title: string;
  delta: number;
  strategy: string;
  metadata: AssetMetadata | undefined;
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

function containsAnyWriter(writers: string, needles: string[]): boolean {
  return needles.some((needle) => writers.includes(needle));
}

function summarize(name: string, rows: CandidateRow[]) {
  return {
    rule: name,
    total: rows.reduce((sum, row) => sum + row.delta, 0),
    rowCount: rows.length,
    assets: Array.from(new Set(rows.map((row) => row.assetId))).length,
    sample: rows.slice(0, 12).map((row) => ({
      delta: row.delta,
      assetId: row.assetId,
      customId: row.customId,
      title: row.title,
      strategy: row.strategy,
      writers: row.metadata?.writers ?? "",
      claimType: row.metadata?.musicClaimType ?? "",
    })),
  };
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const cachePath = path.resolve(process.cwd(), process.argv[3] ?? "asset_metadata_cache_split.json");
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

  const candidates: CandidateRow[] = [];
  for (const row of rows) {
    const ownership = clean(row["Ownership Percentage"]);
    if (ownership !== "41.66") continue;
    const ownershipValue = toNumber(ownership);
    if (!ownershipValue) continue;
    const resolved = resolveAssetId(row, metadataMap, byCustomId, byIsrc, byTitle, byCustomIdIsrc, byCustomIdTitle);
    if (!resolved) continue;
    const metadata = metadataMap[resolved.assetId];
    const revenue = toNumber(row["Partner Revenue"]);
    const delta = revenue * (100 / ownershipValue - 1);
    candidates.push({
      ownership,
      assetId: resolved.assetId,
      customId: clean(row["Custom ID"]),
      title: clean(row["Asset Title"]),
      delta,
      strategy: resolved.strategy,
      metadata,
    });
  }

  const familyA = ["송세라", "전종혁", "양승헌"];
  const familyB = ["주영광", "김기호", "윤승호", "김영표", "안효은", "조미진", "임진", "임선호"];
  const familyC = ["송세라", "전종혁", "양승헌", "주영광", "김기호", "윤승호", "김영표", "안효은", "조미진", "임진", "임선호"];

  const rules = [
    summarize("41.66 + prefix 120 + Sound Recording", candidates.filter((row) => row.customId.startsWith("120") && row.metadata?.assetType === "Sound Recording")),
    summarize("41.66 + prefix 120 + Sound Recording + writer familyA", candidates.filter((row) => row.customId.startsWith("120") && row.metadata?.assetType === "Sound Recording" && containsAnyWriter(row.metadata?.writers ?? "", familyA))),
    summarize("41.66 + prefix 120 + Sound Recording + writer familyB", candidates.filter((row) => row.customId.startsWith("120") && row.metadata?.assetType === "Sound Recording" && containsAnyWriter(row.metadata?.writers ?? "", familyB))),
    summarize("41.66 + prefix 120 + Sound Recording + writer familyA or familyB", candidates.filter((row) => row.customId.startsWith("120") && row.metadata?.assetType === "Sound Recording" && (containsAnyWriter(row.metadata?.writers ?? "", familyA) || containsAnyWriter(row.metadata?.writers ?? "", familyB)))),
    summarize("41.66 + Sound Recording + writer familyC", candidates.filter((row) => row.metadata?.assetType === "Sound Recording" && containsAnyWriter(row.metadata?.writers ?? "", familyC))),
    summarize("41.66 + prefix 120/180 + Sound Recording + writer familyC", candidates.filter((row) => ["120", "180"].includes(row.customId.slice(0, 3)) && row.metadata?.assetType === "Sound Recording" && containsAnyWriter(row.metadata?.writers ?? "", familyC))),
    summarize("41.66 + prefix 120 + Sound Recording + strategy asset_id_valid/title_has_asset_id/custom_id_unique", candidates.filter((row) => row.customId.startsWith("120") && row.metadata?.assetType === "Sound Recording" && ["asset_id_valid", "title_has_asset_id", "custom_id_unique"].includes(row.strategy))),
  ];

  console.log(JSON.stringify(rules, null, 2));
}

run();
