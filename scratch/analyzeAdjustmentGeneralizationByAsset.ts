import * as fs from "fs";
import * as path from "path";

type Row = Record<string, string>;

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

interface AssetEntry {
  assetId: string;
  baseRevenue: number;
  ownership: string;
  childType: string;
  childTitle: string;
  parentAssetId: string;
  parentType: string;
  parentCustomId: string;
  parentTitle: string;
  features: string[];
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function toNumber(value: string | undefined): number {
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
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

function collectOwnerships(rows: Row[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const assetId = clean(row["Asset ID"]);
    const ownership = clean(row["Ownership Percentage"]);
    if (!assetId || !ownership) continue;
    const bucket = map.get(assetId) ?? new Set<string>();
    bucket.add(ownership);
    map.set(assetId, bucket);
  }
  return map;
}

function classifyTitleFeatures(title: string): string[] {
  const normalized = clean(title).toLowerCase();
  const features: string[] = [];
  if (normalized.includes("jesus") || normalized.includes("예수")) features.push("jesus");
  if (normalized.includes("mr")) features.push("mr");
  if (normalized.includes("live")) features.push("live");
  if (normalized.includes("feat")) features.push("feat");
  if (normalized.includes("광야") || normalized.includes("wilderness")) features.push("wilderness");
  if (normalized.includes("부르신") || normalized.includes("calling")) features.push("calling");
  if (normalized.includes("말씀") || normalized.includes("word")) features.push("word");
  if (normalized.includes("은혜") || normalized.includes("grace")) features.push("grace");
  return features;
}

function sortByRevenue(entries: AssetEntry[]) {
  return [...entries]
    .sort((a, b) => b.baseRevenue - a.baseRevenue)
    .slice(0, 20)
    .map((entry) => ({
      assetId: entry.assetId,
      baseRevenue: entry.baseRevenue,
      ownership: entry.ownership,
      childTitle: entry.childTitle,
      parentCustomId: entry.parentCustomId,
      parentTitle: entry.parentTitle,
      features: entry.features,
    }));
}

function run(): void {
  const rulesPath = path.resolve(process.cwd(), process.argv[2] ?? "publishing_royalty_202604_candidate_rules.json");
  const relationshipsPath = path.resolve(process.cwd(), process.argv[3] ?? "scratch/ad_pub_adj_relationships.json");
  const adjProbeDir = path.resolve(process.cwd(), process.argv[4] ?? "scratch/xlsx_probe/ad_pub_adj");
  const adProbeDir = path.resolve(process.cwd(), process.argv[5] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const subProbeDir = path.resolve(process.cwd(), process.argv[6] ?? "scratch/xlsx_probe/red_pub_26_3");

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8")) as CandidateRulesFile;
  const relationships = JSON.parse(fs.readFileSync(relationshipsPath, "utf-8")) as Record<string, RelationshipRecord>;
  const adjRows = readProbeRows(adjProbeDir);
  const adOwnerships = collectOwnerships(readProbeRows(adProbeDir));
  const subOwnerships = collectOwnerships(readProbeRows(subProbeDir));

  const byAsset = new Map<string, AssetEntry>();
  for (const row of adjRows) {
    const assetId = clean(row["Asset ID"]);
    const record = relationships[assetId];
    const child = record?.assetMetadata?.[assetId];
    const parentId = clean(record?.allRelations?.[0]?.parentAssetId || record?.relatedAssetIds?.[0]);
    const parent = parentId ? record?.assetMetadata?.[parentId] : undefined;
    const childTitle = clean(child?.title || child?.metadata?.title || row["Asset Title"]);
    const parentTitle = clean(parent?.title || parent?.metadata?.title);
    const ownership =
      [...(adOwnerships.get(assetId) ?? new Set<string>())][0] ??
      [...(subOwnerships.get(assetId) ?? new Set<string>())][0] ??
      "";

    const current = byAsset.get(assetId) ?? {
      assetId,
      baseRevenue: 0,
      ownership,
      childType: clean(child?.type),
      childTitle,
      parentAssetId: parentId,
      parentType: clean(parent?.type),
      parentCustomId: clean(parent?.customId),
      parentTitle,
      features: classifyTitleFeatures(childTitle || parentTitle),
    };
    current.baseRevenue += toNumber(row["Partner Revenue"]);
    byAsset.set(assetId, current);
  }

  const universe = [...byAsset.values()].filter((entry) => entry.childType === "composition" && entry.parentType === "sound_recording");
  const selectedUpscales = universe.filter((entry) => rules.adjustment.upscaleAssetIds.includes(entry.assetId));
  const selectedDrops = universe.filter((entry) => rules.adjustment.dropAssetIds.includes(entry.assetId));
  const withParent120 = universe.filter((entry) => entry.parentCustomId.startsWith("120"));

  console.log(
    JSON.stringify(
      {
        universe: {
          assetLevelCompositionToRecordingCount: universe.length,
          assetLevelParent120Count: withParent120.length,
        },
        selectedUpscales: sortByRevenue(selectedUpscales),
        selectedDrops: sortByRevenue(selectedDrops),
        nonSelectedParent120Top: sortByRevenue(
          withParent120.filter(
            (entry) =>
              !rules.adjustment.upscaleAssetIds.includes(entry.assetId) &&
              !rules.adjustment.dropAssetIds.includes(entry.assetId),
          ),
        ),
      },
      null,
      2,
    ),
  );
}

run();
