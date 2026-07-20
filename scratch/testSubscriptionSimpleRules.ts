import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

type Row = Record<string, string>;

interface ResolvedAsset {
  assetId: string;
  strategy: string;
}

interface CandidateRow {
  assetId: string;
  customId: string;
  title: string;
  ownership: string;
  delta: number;
  metadata: AssetMetadata | undefined;
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

function classifyTitleFeatures(title: string): string[] {
  const normalized = title.toLowerCase();
  const features: string[] = [];
  if (normalized.includes("jesus") || normalized.includes("예수")) features.push("jesus");
  if (normalized.includes("lord") || normalized.includes("주님")) features.push("lord");
  if (normalized.includes("faith") || normalized.includes("믿음")) features.push("faith");
  if (normalized.includes("꿈이") || normalized.includes("쑥쑥") || normalized.includes("최고로") || normalized.includes("아이")) features.push("kids");
  return features;
}

function containsAnyWriter(writers: string, needles: string[]): boolean {
  return needles.some((needle) => writers.includes(needle));
}

function summarize(rule: string, rows: CandidateRow[]) {
  return {
    rule,
    total: rows.reduce((sum, row) => sum + row.delta, 0),
    assetCount: Array.from(new Set(rows.map((row) => row.assetId))).length,
    rowCount: rows.length,
    sample: rows.slice(0, 20).map((row) => ({
      delta: row.delta,
      assetId: row.assetId,
      customId: row.customId,
      title: row.title || row.metadata?.title || "",
      writers: row.metadata?.writers ?? "",
      claimType: row.metadata?.musicClaimType ?? "",
      assetType: row.metadata?.assetType ?? "",
      strategy: row.strategy,
      features: classifyTitleFeatures(row.title || row.metadata?.title || ""),
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

  const entries: CandidateRow[] = [];
  for (const row of rows) {
    const ownership = clean(row["Ownership Percentage"]);
    if (ownership !== "41.66") continue;
    const resolved = resolveAssetId(row, metadataMap, byCustomId, byIsrc, byTitle, byCustomIdIsrc, byCustomIdTitle);
    if (!resolved) continue;
    const revenue = toNumber(row["Partner Revenue"]);
    const delta = revenue * (100 / 41.66 - 1);
    entries.push({
      assetId: resolved.assetId,
      customId: clean(row["Custom ID"]),
      title: clean(row["Asset Title"]),
      ownership,
      delta,
      metadata: metadataMap[resolved.assetId],
      strategy: resolved.strategy,
    });
  }

  const writerCore = ["전종혁", "양승헌", "송세라", "주영광", "김기호", "윤승호", "김영표", "안효은", "조미진"];
  const writerKids = ["전종혁", "양승헌", "송세라", "안효은", "조미진", "임진", "임선호"];
  const titleHas = (row: CandidateRow, feature: string) => classifyTitleFeatures(row.title || row.metadata?.title || "").includes(feature);

  const rules = [
    summarize("41.66 + Sound Recording + prefix120", entries.filter((row) => row.metadata?.assetType === "Sound Recording" && (row.metadata?.customId ?? "").startsWith("120"))),
    summarize("41.66 + Sound Recording + prefix120 + writerCore", entries.filter((row) => row.metadata?.assetType === "Sound Recording" && (row.metadata?.customId ?? "").startsWith("120") && containsAnyWriter(row.metadata?.writers ?? "", writerCore))),
    summarize("41.66 + Sound Recording + prefix120 + writerKids", entries.filter((row) => row.metadata?.assetType === "Sound Recording" && (row.metadata?.customId ?? "").startsWith("120") && containsAnyWriter(row.metadata?.writers ?? "", writerKids))),
    summarize("41.66 + Sound Recording + prefix120 + kids/jesus/faith/lord title", entries.filter((row) => row.metadata?.assetType === "Sound Recording" && (row.metadata?.customId ?? "").startsWith("120") && ["kids", "jesus", "faith", "lord"].some((feature) => titleHas(row, feature)))),
    summarize("41.66 + Sound Recording + prefix120 + writerCore + kids/jesus/faith/lord", entries.filter((row) => row.metadata?.assetType === "Sound Recording" && (row.metadata?.customId ?? "").startsWith("120") && containsAnyWriter(row.metadata?.writers ?? "", writerCore) && ["kids", "jesus", "faith", "lord"].some((feature) => titleHas(row, feature)))),
    summarize("41.66 + Sound Recording + strategy title_has_asset_id/custom_id_unique", entries.filter((row) => row.metadata?.assetType === "Sound Recording" && ["title_has_asset_id", "custom_id_unique"].includes(row.strategy))),
  ];

  console.log(JSON.stringify(rules, null, 2));
}

run();
