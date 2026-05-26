import * as fs from "fs";
import * as path from "path";

type WorkbookRow = Record<string, string>;

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

function parseWorksheet(sheetXml: string, sharedStrings: string[]): WorkbookRow[] {
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
  if (headerRowIndex < 0) {
    return [];
  }

  const headerCells = parseRow(rowMatches[headerRowIndex]?.[2] ?? "");
  const headerOrder = Array.from(headerCells.keys());
  const headers = headerOrder.map((column) => headerCells.get(column) ?? "");
  const rows: WorkbookRow[] = [];

  for (const rowMatch of rowMatches.slice(headerRowIndex + 1)) {
    const cellMap = parseRow(rowMatch[2] ?? "");
    const row: WorkbookRow = {};
    for (let index = 0; index < headerOrder.length; index += 1) {
      const header = headers[index] ?? "";
      const column = headerOrder[index] ?? "";
      if (!header) {
        continue;
      }
      row[header] = cellMap.get(column) ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function sumBy(rows: WorkbookRow[], key: string, valueKey: string): Array<{ key: string; sum: number; count: number }> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const bucket = (row[key] ?? "").trim() || "(blank)";
    const value = Number((row[valueKey] ?? "0").trim()) || 0;
    const entry = totals.get(bucket) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count += 1;
    totals.set(bucket, entry);
  }

  return Array.from(totals.entries())
    .map(([groupKey, value]) => ({ key: groupKey, sum: value.sum, count: value.count }))
    .sort((left, right) => right.sum - left.sum);
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
  console.log(`[ParsePublishingProbe] rows=${rows.length} dir=${probeDir}`);

  const valueKey =
    rows[0] && "Partner Revenue" in rows[0]
      ? "Partner Revenue"
      : rows[0] && "AllocatedAmount" in rows[0]
        ? "AllocatedAmount"
        : rows[0] && "AllocatedNetRevenue" in rows[0]
          ? "AllocatedNetRevenue"
          : "";

  if (!valueKey) {
    console.log("[ParsePublishingProbe] Could not detect value column.");
    return;
  }

  const total = rows.reduce((sum, row) => sum + (Number((row[valueKey] ?? "0").trim()) || 0), 0);
  console.log(`[ParsePublishingProbe] valueKey=${valueKey} total=${total.toFixed(12)}`);

  for (const key of ["Country", "Composition Right Type", "Music Claim Type", "Adjustment Type", "Offer", "Territory", "RightsType"]) {
    if (!rows[0] || !(key in rows[0])) {
      continue;
    }
    console.log(`\n[ParsePublishingProbe] group=${key}`);
    for (const entry of sumBy(rows, key, valueKey).slice(0, 20)) {
      console.log(`${entry.key}\t${entry.sum.toFixed(12)}\t${entry.count}`);
    }
  }
}

run();
