import * as fs from "fs";
import * as path from "path";

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

interface AssetSummary {
  assetId: string;
  title: string;
  customId: string;
  claimTypes: Set<string>;
  rightTypes: Set<string>;
}

function buildAssetSummaries(rows: Row[]): Map<string, AssetSummary> {
  const byAsset = new Map<string, AssetSummary>();
  for (const row of rows) {
    const assetId = (row["Asset ID"] ?? "").trim();
    if (!assetId) continue;
    const entry =
      byAsset.get(assetId) ??
      {
        assetId,
        title: (row["Asset Title"] ?? "").trim(),
        customId: (row["Custom ID"] ?? "").trim(),
        claimTypes: new Set<string>(),
        rightTypes: new Set<string>(),
      };
    entry.claimTypes.add((row["Music Claim Type"] ?? "").trim());
    entry.rightTypes.add((row["Composition Right Type"] ?? "").trim());
    byAsset.set(assetId, entry);
  }
  return byAsset;
}

function hasAny(set: Set<string>, values: string[]): boolean {
  return values.some((value) => set.has(value));
}

function shouldExclude(asset: AssetSummary): boolean {
  const title = asset.title;
  const liveOrOfficial = /live|official/i.test(title);
  const coverOnly = asset.claimTypes.size === 1 && asset.claimTypes.has("Cover");
  const mechanicalOnly = asset.rightTypes.size === 1 && asset.rightTypes.has("Mechanical");
  return liveOrOfficial || coverOnly || mechanicalOnly;
}

function sumRows(rows: Row[], keptAssetIds: Set<string>): number {
  return rows.reduce((sum, row) => {
    const assetId = (row["Asset ID"] ?? "").trim();
    if (!keptAssetIds.has(assetId)) return sum;
    return sum + (Number((row["Partner Revenue"] ?? "0").trim()) || 0);
  }, 0);
}

function run(): void {
  const adProbeDir = path.resolve(process.cwd(), "scratch/xlsx_probe/ad_pub_26_3");
  const subProbeDir = path.resolve(process.cwd(), "scratch/xlsx_probe/red_pub_26_3");
  const adjProbeDir = path.resolve(process.cwd(), "scratch/xlsx_probe/ad_pub_adj");

  const adRows = parseWorksheet(
    fs.readFileSync(path.join(adProbeDir, "xl/worksheets/sheet1.xml"), "utf-8"),
    loadSharedStrings(fs.readFileSync(path.join(adProbeDir, "xl/sharedStrings.xml"), "utf-8")),
  );
  const subRows = parseWorksheet(
    fs.readFileSync(path.join(subProbeDir, "xl/worksheets/sheet1.xml"), "utf-8"),
    loadSharedStrings(fs.readFileSync(path.join(subProbeDir, "xl/sharedStrings.xml"), "utf-8")),
  );
  const adjRows = parseWorksheet(
    fs.readFileSync(path.join(adjProbeDir, "xl/worksheets/sheet1.xml"), "utf-8"),
    loadSharedStrings(fs.readFileSync(path.join(adjProbeDir, "xl/sharedStrings.xml"), "utf-8")),
  );

  const adAssets = buildAssetSummaries(adRows);
  const keptAssetIds = new Set(
    Array.from(adAssets.values())
      .filter((asset) => !shouldExclude(asset))
      .map((asset) => asset.assetId),
  );

  console.log(`[CheckRuleAcrossPublishingProbes] keptAssets=${keptAssetIds.size} totalAssets=${adAssets.size}`);
  console.log(`[CheckRuleAcrossPublishingProbes] ad=${sumRows(adRows, keptAssetIds).toFixed(12)}`);
  console.log(`[CheckRuleAcrossPublishingProbes] adj=${sumRows(adjRows, keptAssetIds).toFixed(12)}`);
  console.log(`[CheckRuleAcrossPublishingProbes] sub=${sumRows(subRows, keptAssetIds).toFixed(12)}`);
}

run();
