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
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const targetDelta = Number(process.argv[3] ?? "273.122648698728");
  const ownershipCsv = process.argv[4] ?? "16.66,83.33,50,41.66,41.67";
  const ownershipSet = new Set(ownershipCsv.split(",").map((value) => value.trim()).filter(Boolean));
  const minDelta = Number(process.argv[5] ?? "0.5");
  const tolerance = Number(process.argv[6] ?? "1");
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
    const entry =
      byAsset.get(key) ??
      { key, assetId, customId, title, ownership, delta: 0 };
    entry.delta += delta;
    byAsset.set(key, entry);
  }

  const candidates = [...byAsset.values()].filter((entry) => entry.delta >= minDelta).sort((a, b) => b.delta - a.delta);
  const top = candidates.slice(0, 40);
  const results: Array<{ keys: string[]; total: number; diff: number }> = [];

  for (let i = 0; i < top.length; i += 1) {
    const c1 = top[i]!;
    const t1 = c1.delta;
    if (Math.abs(t1 - targetDelta) <= tolerance) results.push({ keys: [c1.key], total: t1, diff: Math.abs(t1 - targetDelta) });
    for (let j = i + 1; j < top.length; j += 1) {
      const c2 = top[j]!;
      const t2 = t1 + c2.delta;
      if (Math.abs(t2 - targetDelta) <= tolerance) results.push({ keys: [c1.key, c2.key], total: t2, diff: Math.abs(t2 - targetDelta) });
      for (let k = j + 1; k < top.length; k += 1) {
        const c3 = top[k]!;
        const t3 = t2 + c3.delta;
        if (Math.abs(t3 - targetDelta) <= tolerance) results.push({ keys: [c1.key, c2.key, c3.key], total: t3, diff: Math.abs(t3 - targetDelta) });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        targetDelta,
        ownerships: [...ownershipSet],
        candidateCount: candidates.length,
        topCandidates: top.slice(0, 20),
        best: results.sort((a, b) => a.diff - b.diff).slice(0, 20),
      },
      null,
      2,
    ),
  );
}

run();
