import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

type Row = Record<string, string>;

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

function splitTerms(value: string): string[] {
  return clean(value)
    .split(/[;,/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_adj");
  const cachePath = path.resolve(process.cwd(), process.argv[3] ?? "asset_metadata_cache_split.json");
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
  const metadataMap = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetMetadata>;

  const byOwnership = new Map<string, number>();
  const byAsset = new Map<string, number>();
  const byWriter = new Map<string, number>();
  const byClaimType = new Map<string, number>();
  const byType = new Map<string, number>();

  for (const row of rows) {
    const ownership = clean(row["Ownership Percentage"]);
    const assetId = clean(row["Asset ID"]);
    const revenue = toNumber(row["Partner Revenue"]);
    const metadata = metadataMap[assetId];
    byOwnership.set(ownership, (byOwnership.get(ownership) ?? 0) + revenue);
    byAsset.set(assetId, (byAsset.get(assetId) ?? 0) + revenue);
    for (const writer of splitTerms(metadata?.writers ?? "")) {
      byWriter.set(writer, (byWriter.get(writer) ?? 0) + revenue);
    }
    const claimType = clean(metadata?.musicClaimType);
    const assetType = clean(metadata?.assetType);
    if (claimType) byClaimType.set(claimType, (byClaimType.get(claimType) ?? 0) + revenue);
    if (assetType) byType.set(assetType, (byType.get(assetType) ?? 0) + revenue);
  }

  const topAssets = [...byAsset.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([assetId, revenue]) => {
      const metadata = metadataMap[assetId];
      return {
        assetId,
        revenue,
        title: metadata?.title ?? "",
        customId: metadata?.customId ?? "",
        writers: metadata?.writers ?? "",
        assetType: metadata?.assetType ?? "",
        musicClaimType: metadata?.musicClaimType ?? "",
      };
    });

  const summarize = (map: Map<string, number>, slice = 20) =>
    [...map.entries()]
      .filter(([key]) => key)
      .sort((a, b) => b[1] - a[1])
      .slice(0, slice)
      .map(([key, revenue]) => ({ key, revenue }));

  console.log(
    JSON.stringify(
      {
        rowCount: rows.length,
        totalRevenue: rows.reduce((sum, row) => sum + toNumber(row["Partner Revenue"]), 0),
        ownershipRevenue: summarize(byOwnership, 20),
        writerRevenue: summarize(byWriter, 30),
        claimTypeRevenue: summarize(byClaimType, 10),
        assetTypeRevenue: summarize(byType, 10),
        topAssets,
      },
      null,
      2,
    ),
  );
}

run();
