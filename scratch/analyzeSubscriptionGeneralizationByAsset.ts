import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

type Row = Record<string, string>;

interface CandidateRulesFile {
  subscription: {
    exclusionKeys: string[];
  };
}

interface AssetAggregate {
  assetId: string;
  ownership: string;
  customId: string;
  title: string;
  delta: number;
  assetType: string;
  claimType: string;
  rightType: string;
  features: string[];
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

function readProbeRows(probeDir: string): Row[] {
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  return parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
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
    const isrcComposite = byCustomIdIsrc.get(`${customId}|${assetId}`);
    if (isrcComposite?.length === 1) return isrcComposite[0]!.assetId;
    const titleComposite = byCustomIdTitle.get(`${customId}|${title}`);
    if (titleComposite?.length === 1) return titleComposite[0]!.assetId;
  }
  if (assetId) {
    const isrcMatch = byIsrc.get(assetId);
    if (isrcMatch?.length === 1) return isrcMatch[0]!.assetId;
  }
  if (title) {
    const titleIsrcMatch = byIsrc.get(title);
    if (titleIsrcMatch?.length === 1) return titleIsrcMatch[0]!.assetId;
  }
  if (customId) {
    const customMatch = byCustomId.get(customId);
    if (customMatch?.length === 1) return customMatch[0]!.assetId;
  }
  if (title) {
    const titleMatch = byTitle.get(title);
    if (titleMatch?.length === 1) return titleMatch[0]!.assetId;
  }
  return null;
}

function classifyTitleFeatures(title: string): string[] {
  const normalized = clean(title).toLowerCase();
  const features: string[] = [];
  if (normalized.includes("jesus") || normalized.includes("예수")) features.push("jesus");
  if (normalized.includes("광야") || normalized.includes("wilderness")) features.push("wilderness");
  if (normalized.includes("믿음") || normalized.includes("faith")) features.push("faith");
  if (normalized.includes("기도") || normalized.includes("prayer")) features.push("prayer");
  if (normalized.includes("왕")) features.push("king");
  if (normalized.includes("은혜") || normalized.includes("grace")) features.push("grace");
  return features;
}

function sortByDelta(entries: AssetAggregate[]) {
  return [...entries]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 20)
    .map((entry) => ({
      assetId: entry.assetId,
      delta: entry.delta,
      ownership: entry.ownership,
      customId: entry.customId,
      title: entry.title,
      assetType: entry.assetType,
      claimType: entry.claimType,
      rightType: entry.rightType,
      features: entry.features,
    }));
}

function run(): void {
  const rulesPath = path.resolve(process.cwd(), process.argv[2] ?? "publishing_royalty_202604_candidate_rules.json");
  const metadataPath = path.resolve(process.cwd(), process.argv[3] ?? "asset_metadata_cache_split.json");
  const probeDir = path.resolve(process.cwd(), process.argv[4] ?? "scratch/xlsx_probe/red_pub_26_3");

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8")) as CandidateRulesFile;
  const metadataMap = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as Record<string, AssetMetadata>;
  const records = Object.values(metadataMap).filter((record) => record.sourceCategory === "Publishing");
  const rows = readProbeRows(probeDir);

  const byCustomId = buildIndex(records, (record) => record.customId);
  const byIsrc = buildIndex(records, (record) => record.isrc);
  const byTitle = buildIndex(records, (record) => record.title);
  const byCustomIdIsrc = buildCompositeIndex(records, (record) => record.customId, (record) => record.isrc);
  const byCustomIdTitle = buildCompositeIndex(records, (record) => record.customId, (record) => record.title);

  const byAsset = new Map<string, AssetAggregate>();
  for (const row of rows) {
    const resolvedAssetId = resolveAssetId(
      row,
      metadataMap,
      byCustomId,
      byIsrc,
      byTitle,
      byCustomIdIsrc,
      byCustomIdTitle,
    );
    if (!resolvedAssetId) continue;
    const ownership = clean(row["Ownership Percentage"]);
    const ownershipValue = toNumber(ownership);
    if (!ownershipValue || ownershipValue === 100) continue;
    const revenue = toNumber(row["Partner Revenue"]);
    const delta = revenue * (100 / ownershipValue - 1);
    const metadata = metadataMap[resolvedAssetId];
    const current = byAsset.get(resolvedAssetId) ?? {
      assetId: resolvedAssetId,
      ownership,
      customId: clean(metadata?.customId || row["Custom ID"]),
      title: clean(metadata?.title || row["Asset Title"]),
      delta: 0,
      assetType: clean(metadata?.assetType),
      claimType: clean(metadata?.musicClaimType),
      rightType: clean(metadata?.compositionRightType),
      features: classifyTitleFeatures(clean(metadata?.title || row["Asset Title"])),
    };
    current.delta += delta;
    byAsset.set(resolvedAssetId, current);
  }

  const exclusionAssetIds = new Set(
    rules.subscription.exclusionKeys.map((key) => clean(key.split("|")[1])),
  );
  const universe = [...byAsset.values()];
  const selected = universe.filter((entry) => exclusionAssetIds.has(entry.assetId));
  const selectedLike = universe.filter(
    (entry) =>
      entry.rightType === "Performance" &&
      entry.customId.startsWith("120") &&
      ["16.66", "41.66", "83.33"].includes(entry.ownership),
  );

  console.log(
    JSON.stringify(
      {
        universe: {
          assetLevelPartialCount: universe.length,
          assetLevelSelectedCount: selected.length,
          assetLevelSelectedLikeCount: selectedLike.length,
        },
        selected: sortByDelta(selected),
        nonSelectedLikeTop: sortByDelta(selectedLike.filter((entry) => !exclusionAssetIds.has(entry.assetId))),
      },
      null,
      2,
    ),
  );
}

run();
