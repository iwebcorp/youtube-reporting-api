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
}

interface OperationEntry {
  value: number;
  label: string;
}

interface ResultEntry {
  total: number;
  diff: number;
  labels: string[];
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

function enumerateOperationChoices(
  operations: OperationEntry[][],
  index = 0,
  total = 0,
  labels: string[] = [],
  out: Array<{ total: number; labels: string[] }> = [],
): Array<{ total: number; labels: string[] }> {
  if (index >= operations.length) {
    out.push({ total, labels: [...labels] });
    return out;
  }
  for (const operation of operations[index]!) {
    if (operation.label !== "keep") labels.push(operation.label);
    enumerateOperationChoices(operations, index + 1, total + operation.value, labels, out);
    if (operation.label !== "keep") labels.pop();
  }
  return out;
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

function run(): void {
  const adjDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_adj");
  const adDir = path.resolve(process.cwd(), process.argv[3] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const subDir = path.resolve(process.cwd(), process.argv[4] ?? "scratch/xlsx_probe/red_pub_26_3");
  const cachePath = path.resolve(process.cwd(), process.argv[5] ?? "asset_metadata_cache_split.json");
  const targetDiff = Number(process.argv[6] ?? "0.568312654408008");
  const topN = Number(process.argv[7] ?? "16");
  const tolerance = Number(process.argv[8] ?? "0.0005");
  const limit = Number(process.argv[9] ?? "30");

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
    const existing = byAsset.get(assetId) ?? { assetId, title, baseRevenue: 0, ownership, upscaleDelta: 0 };
    existing.baseRevenue += baseRevenue;
    existing.upscaleDelta += upscaleDelta;
    if (!existing.title) existing.title = title;
    if (!existing.ownership) existing.ownership = ownership;
    byAsset.set(assetId, existing);
  }

  const candidates = [...byAsset.values()]
    .filter((entry) => entry.baseRevenue > 0)
    .sort((a, b) => Math.max(b.baseRevenue, b.upscaleDelta) - Math.max(a.baseRevenue, a.upscaleDelta))
    .slice(0, topN);

  const operations = candidates.map((entry) => {
    const ops: OperationEntry[] = [{ value: 0, label: "keep" }, { value: -entry.baseRevenue, label: `drop:${entry.assetId}` }];
    if (entry.upscaleDelta > 0) ops.push({ value: entry.upscaleDelta, label: `upscale:${entry.assetId}` });
    return ops;
  });

  const best = enumerateOperationChoices(operations)
    .map((entry) => ({ ...entry, diff: Math.abs(entry.total - targetDiff) }))
    .filter((entry) => entry.diff <= tolerance)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, limit) as ResultEntry[];

  const opCounts = new Map<string, number>();
  for (const result of best) {
    for (const label of result.labels) opCounts.set(label, (opCounts.get(label) ?? 0) + 1);
  }

  const repeated = [...opCounts.entries()].sort((a, b) => b[1] - a[1]);
  const summarizeGroup = (prefix: "upscale:" | "drop:") =>
    repeated
      .filter(([label]) => label.startsWith(prefix))
      .map(([label, count]) => {
        const assetId = label.slice(prefix.length);
        const asset = byAsset.get(assetId);
        const metadata = metadataMap[assetId];
        return {
          count,
          assetId,
          title: asset?.title ?? metadata?.title ?? "",
          ownership: asset?.ownership ?? "",
          baseRevenue: asset?.baseRevenue ?? 0,
          upscaleDelta: asset?.upscaleDelta ?? 0,
          customId: metadata?.customId ?? "",
          writers: metadata?.writers ?? "",
          assetType: metadata?.assetType ?? "",
          musicClaimType: metadata?.musicClaimType ?? "",
          features: classifyTitleFeatures(asset?.title ?? metadata?.title ?? ""),
        };
      });

  const writerCounts = new Map<string, number>();
  const featureCounts = new Map<string, number>();
  for (const row of summarizeGroup("drop:").concat(summarizeGroup("upscale:"))) {
    for (const writer of splitTerms(row.writers)) writerCounts.set(writer, (writerCounts.get(writer) ?? 0) + row.count);
    for (const feature of row.features) featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + row.count);
  }

  console.log(
    JSON.stringify(
      {
        targetDiff,
        exactCount: best.length,
        topSolutions: best.slice(0, 10),
        repeatedUpscales: summarizeGroup("upscale:"),
        repeatedDrops: summarizeGroup("drop:"),
        repeatedWriters: [...writerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([key, count]) => ({ key, count })),
        repeatedFeatures: [...featureCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })),
      },
      null,
      2,
    ),
  );
}

run();
