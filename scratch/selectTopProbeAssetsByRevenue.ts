import * as fs from "fs";
import * as path from "path";

type Row = Record<string, string>;

interface AssetRevenueEntry {
  assetId: string;
  totalRevenue: number;
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

function toNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const outputPath = path.resolve(process.cwd(), process.argv[3] ?? "scratch/ad_pub_26_3_top_asset_ids.json");
  const limit = Number(process.argv[4] ?? "200");
  const revenueColumn = process.argv[5] ?? "Partner Revenue";
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));

  const byAsset = new Map<string, AssetRevenueEntry>();
  for (const row of rows) {
    const assetId = (row["Asset ID"] ?? "").trim();
    if (!assetId) continue;
    const entry = byAsset.get(assetId) ?? { assetId, totalRevenue: 0 };
    entry.totalRevenue += toNumber(row[revenueColumn]);
    byAsset.set(assetId, entry);
  }

  const topAssetIds = [...byAsset.values()]
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, limit)
    .map((entry) => entry.assetId);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(topAssetIds, null, 2), "utf-8");
  console.log(`[SelectTopProbeAssetsByRevenue] probeDir=${probeDir}`);
  console.log(`[SelectTopProbeAssetsByRevenue] assetCount=${byAsset.size}`);
  console.log(`[SelectTopProbeAssetsByRevenue] selected=${topAssetIds.length}`);
  console.log(`[SelectTopProbeAssetsByRevenue] wrote ${outputPath}`);
}

run();
