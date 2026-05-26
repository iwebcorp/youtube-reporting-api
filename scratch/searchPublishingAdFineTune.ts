import * as fs from "fs";
import * as path from "path";

type Row = Record<string, string>;

interface AssetSummary {
  assetId: string;
  title: string;
  customId: string;
  claimTypes: Set<string>;
  rightTypes: Set<string>;
  revenue: number;
  rowCount: number;
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

function shouldExcludeBase(asset: AssetSummary): boolean {
  const liveOrOfficial = /live|official/i.test(asset.title);
  const coverOnly = asset.claimTypes.size === 1 && asset.claimTypes.has("Cover");
  const mechanicalOnly = asset.rightTypes.size === 1 && asset.rightTypes.has("Mechanical");
  return liveOrOfficial || coverOnly || mechanicalOnly;
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const target = Number(process.argv[3] ?? "2464.324693");
  const tolerance = Number(process.argv[4] ?? "1");
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const assets = buildAssets(parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml)));
  const included = assets.filter((asset) => !shouldExcludeBase(asset));
  const excluded = assets.filter((asset) => shouldExcludeBase(asset));
  const baseTotal = included.reduce((sum, asset) => sum + asset.revenue, 0);
  const baseDiff = target - baseTotal;

  console.log(`[SearchPublishingAdFineTune] baseTotal=${baseTotal.toFixed(12)} target=${target.toFixed(12)} diff=${baseDiff.toFixed(12)}`);

  const includeCandidates = excluded.filter((asset) => asset.revenue <= Math.abs(baseDiff) + tolerance).sort((a, b) => a.revenue - b.revenue);
  const excludeCandidates = included.filter((asset) => asset.revenue <= Math.abs(baseDiff) + tolerance).sort((a, b) => a.revenue - b.revenue);

  console.log("[SearchPublishingAdFineTune] single toggles");
  for (const asset of includeCandidates) {
    const total = baseTotal + asset.revenue;
    const diff = Math.abs(total - target);
    if (diff <= tolerance) {
      console.log(`include\t${asset.assetId}\t${asset.customId}\t${asset.revenue.toFixed(12)}\t${total.toFixed(12)}\t${diff.toFixed(12)}\t${asset.title}`);
    }
  }
  for (const asset of excludeCandidates) {
    const total = baseTotal - asset.revenue;
    const diff = Math.abs(total - target);
    if (diff <= tolerance) {
      console.log(`exclude\t${asset.assetId}\t${asset.customId}\t${asset.revenue.toFixed(12)}\t${total.toFixed(12)}\t${diff.toFixed(12)}\t${asset.title}`);
    }
  }

  console.log("[SearchPublishingAdFineTune] double toggles");
  for (let i = 0; i < includeCandidates.length; i += 1) {
    for (let j = i + 1; j < includeCandidates.length; j += 1) {
      const total = baseTotal + includeCandidates[i]!.revenue + includeCandidates[j]!.revenue;
      const diff = Math.abs(total - target);
      if (diff <= tolerance) {
        console.log(
          `include2\t${includeCandidates[i]!.assetId}+${includeCandidates[j]!.assetId}\t${total.toFixed(12)}\t${diff.toFixed(12)}`,
        );
      }
    }
  }
  for (let i = 0; i < excludeCandidates.length; i += 1) {
    for (let j = i + 1; j < excludeCandidates.length; j += 1) {
      const total = baseTotal - excludeCandidates[i]!.revenue - excludeCandidates[j]!.revenue;
      const diff = Math.abs(total - target);
      if (diff <= tolerance) {
        console.log(
          `exclude2\t${excludeCandidates[i]!.assetId}+${excludeCandidates[j]!.assetId}\t${total.toFixed(12)}\t${diff.toFixed(12)}`,
        );
      }
    }
  }
  for (const add of includeCandidates) {
    for (const remove of excludeCandidates) {
      const total = baseTotal + add.revenue - remove.revenue;
      const diff = Math.abs(total - target);
      if (diff <= tolerance) {
        console.log(
          `swap\tadd=${add.assetId}:${add.revenue.toFixed(12)}\tremove=${remove.assetId}:${remove.revenue.toFixed(12)}\t${total.toFixed(12)}\t${diff.toFixed(12)}`,
        );
      }
    }
  }
}

run();
