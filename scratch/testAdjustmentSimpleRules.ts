import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

type Row = Record<string, string>;

interface AssetEntry {
  assetId: string;
  title: string;
  baseRevenue: number;
  ownership: string;
  upscaleDelta: number;
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

function readRows(probeDir: string): Row[] {
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  return parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function toNumber(value: string | undefined): number {
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
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
  const normalized = title.toLowerCase();
  const features: string[] = [];
  if (normalized.includes("mr")) features.push("mr");
  if (normalized.includes("live")) features.push("live");
  if (normalized.includes("feat")) features.push("feat");
  if (normalized.includes("pf.")) features.push("pf");
  if (normalized.includes("vn.")) features.push("vn");
  if (normalized.includes("예수")) features.push("jesus");
  if (normalized.includes("광야")) features.push("wilderness");
  if (normalized.includes("부르신")) features.push("calling");
  if (normalized.includes("말씀")) features.push("word");
  if (normalized.includes("하나님")) features.push("god");
  return features;
}

function summarize(name: string, value: number, assets: AssetEntry[]) {
  return {
    rule: name,
    value,
    assets: assets.map((asset) => ({
      assetId: asset.assetId,
      title: asset.title,
      ownership: asset.ownership,
      baseRevenue: asset.baseRevenue,
      upscaleDelta: asset.upscaleDelta,
      customId: asset.metadata?.customId ?? "",
      writers: asset.metadata?.writers ?? "",
      assetType: asset.metadata?.assetType ?? "",
      claimType: asset.metadata?.musicClaimType ?? "",
      features: classifyTitleFeatures(asset.title || asset.metadata?.title || ""),
    })),
  };
}

function run(): void {
  const adjDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_adj");
  const adDir = path.resolve(process.cwd(), process.argv[3] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const subDir = path.resolve(process.cwd(), process.argv[4] ?? "scratch/xlsx_probe/red_pub_26_3");
  const cachePath = path.resolve(process.cwd(), process.argv[5] ?? "asset_metadata_cache_split.json");

  const adjRows = readRows(adjDir);
  const adOwnerships = collectOwnerships(readRows(adDir));
  const subOwnerships = collectOwnerships(readRows(subDir));
  const metadataMap = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetMetadata>;
  const byAsset = new Map<string, AssetEntry>();

  for (const row of adjRows) {
    const assetId = clean(row["Asset ID"]);
    const title = clean(row["Asset Title"]);
    const baseRevenue = toNumber(row["Partner Revenue"]);
    const ownership = [...(adOwnerships.get(assetId) ?? new Set<string>())][0] ?? [...(subOwnerships.get(assetId) ?? new Set<string>())][0] ?? "";
    const ownershipValue = Number(ownership);
    const upscaleDelta =
      Number.isFinite(ownershipValue) && ownershipValue > 0 && ownershipValue !== 100
        ? baseRevenue * (100 / ownershipValue - 1)
        : 0;
    const entry = byAsset.get(assetId) ?? {
      assetId,
      title,
      baseRevenue: 0,
      ownership,
      upscaleDelta: 0,
      metadata: metadataMap[assetId],
    };
    entry.baseRevenue += baseRevenue;
    entry.upscaleDelta += upscaleDelta;
    if (!entry.title) entry.title = title;
    byAsset.set(assetId, entry);
  }

  const entries = [...byAsset.values()];
  const titleHas = (asset: AssetEntry, feature: string) => classifyTitleFeatures(asset.title || asset.metadata?.title || "").includes(feature);

  const upscaleCore = entries.filter((asset) => ["A871135003790050", "A786937401112123"].includes(asset.assetId));
  const dropJesus = entries.filter((asset) => titleHas(asset, "jesus"));
  const dropCalling = entries.filter((asset) => titleHas(asset, "calling"));
  const dropWildernessDecorated = entries.filter((asset) => titleHas(asset, "wilderness") && (titleHas(asset, "mr") || titleHas(asset, "pf") || titleHas(asset, "vn")));

  const candidate1Value =
    upscaleCore.reduce((sum, asset) => sum + asset.upscaleDelta, 0) -
    dropJesus.reduce((sum, asset) => sum + asset.baseRevenue, 0) -
    dropCalling.reduce((sum, asset) => sum + asset.baseRevenue, 0);

  const candidate2Value =
    upscaleCore.reduce((sum, asset) => sum + asset.upscaleDelta, 0) +
    dropWildernessDecorated.reduce((sum, asset) => sum + asset.upscaleDelta - asset.baseRevenue, 0) -
    dropJesus.reduce((sum, asset) => sum + asset.baseRevenue, 0) -
    dropCalling.reduce((sum, asset) => sum + asset.baseRevenue, 0);

  console.log(
    JSON.stringify(
      [
        summarize("upscale core two - drop jesus - drop calling", candidate1Value, [...upscaleCore, ...dropJesus, ...dropCalling]),
        summarize("upscale core two + wilderness decorated replacement - drop jesus - drop calling", candidate2Value, [...upscaleCore, ...dropWildernessDecorated, ...dropJesus, ...dropCalling]),
      ],
      null,
      2,
    ),
  );
}

run();
