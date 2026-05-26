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

function run(): void {
  const adjDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_adj");
  const adDir = path.resolve(process.cwd(), process.argv[3] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const subDir = path.resolve(process.cwd(), process.argv[4] ?? "scratch/xlsx_probe/red_pub_26_3");

  const adjRows = readRows(adjDir);
  const adRows = readRows(adDir);
  const subRows = readRows(subDir);
  const adOwnerships = collectOwnerships(adRows);
  const subOwnerships = collectOwnerships(subRows);

  let matchedAdjRevenue = 0;
  let matchedSubRevenue = 0;
  let upscaledAdjRevenue = 0;
  const ownershipBuckets = new Map<string, number>();
  const samples: Array<Record<string, string | number | string[]>> = [];

  for (const row of adjRows) {
    const assetId = clean(row["Asset ID"]);
    const revenue = toNumber(row["Partner Revenue"]);
    const adOwnership = [...(adOwnerships.get(assetId) ?? new Set<string>())];
    const subOwnership = [...(subOwnerships.get(assetId) ?? new Set<string>())];
    if (adOwnership.length > 0) matchedAdjRevenue += revenue;
    if (subOwnership.length > 0) matchedSubRevenue += revenue;

    const candidateOwnership = adOwnership[0] ?? subOwnership[0] ?? "";
    if (candidateOwnership) {
      ownershipBuckets.set(candidateOwnership, (ownershipBuckets.get(candidateOwnership) ?? 0) + revenue);
      const ownershipValue = Number(candidateOwnership);
      if (Number.isFinite(ownershipValue) && ownershipValue > 0) {
        upscaledAdjRevenue += revenue * (100 / ownershipValue);
      } else {
        upscaledAdjRevenue += revenue;
      }
    }

    if ((adOwnership.length > 0 || subOwnership.length > 0) && samples.length < 25) {
      samples.push({
        assetId,
        title: clean(row["Asset Title"]),
        revenue,
        adOwnership,
        subOwnership,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        totalAdjRevenue: adjRows.reduce((sum, row) => sum + toNumber(row["Partner Revenue"]), 0),
        matchedAdjRevenue,
        matchedSubRevenue,
        upscaledAdjRevenue,
        ownershipBuckets: [...ownershipBuckets.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([ownership, revenue]) => ({ ownership, revenue })),
        samples,
      },
      null,
      2,
    ),
  );
}

run();
