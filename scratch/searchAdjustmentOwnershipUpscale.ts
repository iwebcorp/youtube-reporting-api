import * as fs from "fs";
import * as path from "path";

type Row = Record<string, string>;

interface Candidate {
  key: string;
  delta: number;
  baseRevenue: number;
  ownership: string;
}

interface SubsetEntry {
  total: number;
  indexes: number[];
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

function enumerateSubsets(candidates: Candidate[]): SubsetEntry[] {
  const result: SubsetEntry[] = [];
  const subsetCount = 1 << candidates.length;
  for (let mask = 0; mask < subsetCount; mask += 1) {
    let total = 0;
    const indexes: number[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      total += candidates[index]!.delta;
      indexes.push(index);
    }
    result.push({ total, indexes });
  }
  return result.sort((a, b) => a.total - b.total);
}

function run(): void {
  const adjDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_adj");
  const adDir = path.resolve(process.cwd(), process.argv[3] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const subDir = path.resolve(process.cwd(), process.argv[4] ?? "scratch/xlsx_probe/red_pub_26_3");
  const targetDelta = Number(process.argv[5] ?? "0.568312654408008");
  const allowedOwnerships = new Set((process.argv[6] ?? "83.33,16.66,91.66,94.44,83.34,30,16.67,50,41.67,41.66").split(",").map((value) => value.trim()).filter(Boolean));
  const minDelta = Number(process.argv[7] ?? "0.0001");
  const topN = Number(process.argv[8] ?? "24");
  const tolerance = Number(process.argv[9] ?? "0.01");

  const adjRows = readRows(adjDir);
  const adOwnerships = collectOwnerships(readRows(adDir));
  const subOwnerships = collectOwnerships(readRows(subDir));
  const byAsset = new Map<string, Candidate>();

  for (const row of adjRows) {
    const assetId = clean(row["Asset ID"]);
    const title = clean(row["Asset Title"]);
    const revenue = toNumber(row["Partner Revenue"]);
    const ownership = [...(adOwnerships.get(assetId) ?? new Set<string>())][0] ?? [...(subOwnerships.get(assetId) ?? new Set<string>())][0] ?? "";
    if (!allowedOwnerships.has(ownership)) continue;
    const ownershipValue = Number(ownership);
    if (!Number.isFinite(ownershipValue) || ownershipValue <= 0 || ownershipValue === 100) continue;
    const delta = revenue * (100 / ownershipValue - 1);
    const key = `${ownership}|${assetId}|${title}`;
    const entry = byAsset.get(key) ?? { key, delta: 0, baseRevenue: 0, ownership };
    entry.delta += delta;
    entry.baseRevenue += revenue;
    byAsset.set(key, entry);
  }

  const candidates = [...byAsset.values()]
    .filter((entry) => entry.delta >= minDelta)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, topN);

  const midpoint = Math.ceil(candidates.length / 2);
  const left = candidates.slice(0, midpoint);
  const right = candidates.slice(midpoint);
  const leftSubsets = enumerateSubsets(left);
  const rightSubsets = enumerateSubsets(right);

  const results: Array<{ total: number; diff: number; keys: string[] }> = [];
  let rightIndex = rightSubsets.length - 1;
  for (const leftSubset of leftSubsets) {
    while (rightIndex > 0 && leftSubset.total + rightSubsets[rightIndex]!.total > targetDelta) {
      rightIndex -= 1;
    }
    for (const candidateIndex of [rightIndex, rightIndex + 1]) {
      const rightSubset = rightSubsets[candidateIndex];
      if (!rightSubset) continue;
      const total = leftSubset.total + rightSubset.total;
      const diff = Math.abs(total - targetDelta);
      if (diff > tolerance) continue;
      results.push({
        total,
        diff,
        keys: [
          ...leftSubset.indexes.map((index) => left[index]!.key),
          ...rightSubset.indexes.map((index) => right[index]!.key),
        ],
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        targetDelta,
        candidateCount: candidates.length,
        topCandidates: candidates.slice(0, 30),
        best: results.sort((a, b) => a.diff - b.diff).slice(0, 20),
      },
      null,
      2,
    ),
  );
}

run();
