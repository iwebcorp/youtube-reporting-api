import * as fs from "fs";
import * as path from "path";

type Row = Record<string, string>;

interface Candidate {
  key: string;
  assetId: string;
  customId: string;
  title: string;
  ownership: string;
  delta: number;
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

function toNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildCandidates(probeDir: string, ownershipSet: Set<string>, minDelta: number): Candidate[] {
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));

  const byAsset = new Map<string, Candidate>();
  for (const row of rows) {
    const ownership = (row["Ownership Percentage"] ?? "").trim();
    if (!ownershipSet.has(ownership)) continue;
    const revenue = toNumber(row["Partner Revenue"]);
    const ownershipValue = toNumber(ownership);
    if (!ownershipValue) continue;
    const delta = revenue * (100 / ownershipValue - 1);
    const assetId = (row["Asset ID"] ?? "").trim();
    const customId = (row["Custom ID"] ?? "").trim();
    const title = (row["Asset Title"] ?? "").trim();
    const key = `${ownership}|${assetId}|${customId}|${title}`;
    const entry = byAsset.get(key) ?? { key, assetId, customId, title, ownership, delta: 0 };
    entry.delta += delta;
    byAsset.set(key, entry);
  }

  return [...byAsset.values()].filter((entry) => entry.delta >= minDelta).sort((a, b) => b.delta - a.delta);
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

function resolveKeys(candidates: Candidate[], indexes: number[]): string[] {
  return indexes.map((index) => candidates[index]!.key);
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const targetDelta = Number(process.argv[3] ?? "273.122648698728");
  const ownershipCsv = process.argv[4] ?? "16.66,83.33,50,41.66,41.67";
  const minDelta = Number(process.argv[5] ?? "0.5");
  const topN = Number(process.argv[6] ?? "28");
  const tolerance = Number(process.argv[7] ?? "0.1");
  const ownershipSet = new Set(ownershipCsv.split(",").map((value) => value.trim()).filter(Boolean));
  const candidates = buildCandidates(probeDir, ownershipSet, minDelta).slice(0, topN);
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
          ...resolveKeys(left, leftSubset.indexes),
          ...resolveKeys(right, rightSubset.indexes),
        ],
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        targetDelta,
        ownerships: [...ownershipSet],
        minDelta,
        topN,
        candidateCount: candidates.length,
        topCandidates: candidates.slice(0, 20),
        best: results.sort((a, b) => a.diff - b.diff).slice(0, 20),
      },
      null,
      2,
    ),
  );
}

run();
