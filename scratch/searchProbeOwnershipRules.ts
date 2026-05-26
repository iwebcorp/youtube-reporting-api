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

function toNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const targetDelta = Number(process.argv[3] ?? "273.122648698728");
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));

  const byOwnership = new Map<string, number>();
  for (const row of rows) {
    const revenue = toNumber(row["Partner Revenue"]);
    const ownershipRaw = (row["Ownership Percentage"] ?? "").trim();
    const ownership = toNumber(ownershipRaw);
    if (!ownership || ownership === 100) continue;
    const delta = revenue * (100 / ownership - 1);
    byOwnership.set(ownershipRaw, (byOwnership.get(ownershipRaw) ?? 0) + delta);
  }

  const entries = [...byOwnership.entries()]
    .filter(([, value]) => value >= 1)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 20);
  const combos: Array<{ combo: string[]; total: number; diff: number }> = [];
  const pushCombo = (combo: string[], total: number) => {
    combos.push({ combo, total, diff: Math.abs(total - targetDelta) });
  };
  const dfs = (startIndex: number, combo: string[], total: number, maxDepth: number) => {
    if (combo.length > 0) pushCombo(combo, total);
    if (combo.length === maxDepth) return;
    for (let index = startIndex; index < entries.length; index += 1) {
      const [ownership, value] = entries[index]!;
      dfs(index + 1, [...combo, ownership], total + value, maxDepth);
    }
  };
  dfs(0, [], 0, 5);

  console.log(
    JSON.stringify(
      {
        targetDelta,
        byOwnership: Object.fromEntries(entries),
        best: combos.sort((left, right) => left.diff - right.diff).slice(0, 20),
      },
      null,
      2,
    ),
  );
}

run();
