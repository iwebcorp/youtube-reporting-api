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
  customId: string;
  title: string;
  claimTypes: Set<string>;
  rightTypes: Set<string>;
  revenue: number;
  rowCount: number;
}

function buildAssets(rows: Row[]): AssetSummary[] {
  const byAsset = new Map<string, AssetSummary>();
  for (const row of rows) {
    const assetId = (row["Asset ID"] ?? "").trim();
    if (!assetId) continue;
    const entry =
      byAsset.get(assetId) ??
      {
        assetId,
        customId: (row["Custom ID"] ?? "").trim(),
        title: (row["Asset Title"] ?? "").trim(),
        claimTypes: new Set<string>(),
        rightTypes: new Set<string>(),
        revenue: 0,
        rowCount: 0,
      };
    entry.claimTypes.add((row["Music Claim Type"] ?? "").trim());
    entry.rightTypes.add((row["Composition Right Type"] ?? "").trim());
    entry.revenue += Number((row["Partner Revenue"] ?? "0").trim()) || 0;
    entry.rowCount += 1;
    byAsset.set(assetId, entry);
  }
  return Array.from(byAsset.values());
}

function hasAny(set: Set<string>, values: string[]): boolean {
  return values.some((value) => set.has(value));
}

function evaluatePattern(asset: AssetSummary, pattern: string): boolean {
  const title = asset.title;
  const prefix = asset.customId.slice(0, 3);
  switch (pattern) {
    case "mr":
      return /\bmr\b|\(mr\)|inst/i.test(title);
    case "live_or_official":
      return /live|official/i.test(title);
    case "prefix_200":
      return prefix === "200";
    case "prefix_101":
      return prefix === "101";
    case "prefix_120":
      return prefix === "120";
    case "prefix_180":
      return prefix === "180";
    case "prefix_160":
      return prefix === "160";
    case "rowcount_2":
      return asset.rowCount === 2;
    case "rowcount_4":
      return asset.rowCount === 4;
    case "cover_only":
      return asset.claimTypes.size === 1 && asset.claimTypes.has("Cover");
    case "embedded_only":
      return asset.claimTypes.size === 1 && asset.claimTypes.has("Embedded");
    case "mixed_claim":
      return hasAny(asset.claimTypes, ["Cover"]) && hasAny(asset.claimTypes, ["Embedded"]);
    case "mechanical_only":
      return asset.rightTypes.size === 1 && asset.rightTypes.has("Mechanical");
    case "performance_only":
      return asset.rightTypes.size === 1 && asset.rightTypes.has("Performance");
    case "mechanical_performance":
      return hasAny(asset.rightTypes, ["Mechanical"]) && hasAny(asset.rightTypes, ["Performance"]);
    default:
      return false;
  }
}

function search(
  assets: AssetSummary[],
  target: number,
  patterns: string[],
): Array<{ patterns: string[]; total: number; diff: number; excluded: number }> {
  const results: Array<{ patterns: string[]; total: number; diff: number; excluded: number }> = [];
  const total = assets.reduce((sum, asset) => sum + asset.revenue, 0);
  const combos: string[][] = [[]];
  for (const pattern of patterns) {
    combos.push([pattern]);
  }
  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      combos.push([patterns[i]!, patterns[j]!]);
    }
  }
  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      for (let k = j + 1; k < patterns.length; k += 1) {
        combos.push([patterns[i]!, patterns[j]!, patterns[k]!]);
      }
    }
  }

  for (const combo of combos) {
    const filtered = assets.filter((asset) => !combo.some((pattern) => evaluatePattern(asset, pattern)));
    const filteredTotal = filtered.reduce((sum, asset) => sum + asset.revenue, 0);
    results.push({
      patterns: combo,
      total: filteredTotal,
      diff: Math.abs(filteredTotal - target),
      excluded: total - filteredTotal,
    });
  }

  return results.sort((left, right) => left.diff - right.diff).slice(0, 30);
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const target = Number(process.argv[3] ?? "2464.324693");
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const assets = buildAssets(parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml)));
  const patterns = [
    "mr",
    "live_or_official",
    "prefix_200",
    "prefix_101",
    "prefix_120",
    "prefix_180",
    "prefix_160",
    "rowcount_2",
    "rowcount_4",
    "cover_only",
    "embedded_only",
    "mixed_claim",
    "mechanical_only",
    "performance_only",
    "mechanical_performance",
  ];

  const total = assets.reduce((sum, asset) => sum + asset.revenue, 0);
  console.log(`[SearchPublishingAdRules] total=${total.toFixed(12)} target=${target.toFixed(12)}`);
  for (const result of search(assets, target, patterns)) {
    console.log(
      `${result.patterns.join("+") || "(none)"}\ttotal=${result.total.toFixed(12)}\texcluded=${result.excluded.toFixed(12)}\tdiff=${result.diff.toFixed(12)}`,
    );
  }
}

run();
