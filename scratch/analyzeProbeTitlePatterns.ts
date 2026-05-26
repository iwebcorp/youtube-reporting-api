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

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));

  const patterns: Array<{ label: string; test: (title: string, customId: string) => boolean }> = [
    { label: "mr", test: (title) => /\bmr\b|\(mr\)|inst/i.test(title) },
    { label: "live_or_official", test: (title) => /live|official/i.test(title) },
    { label: "prefix_200", test: (_title, customId) => customId.startsWith("200") },
    { label: "prefix_101", test: (_title, customId) => customId.startsWith("101") },
    { label: "prefix_120", test: (_title, customId) => customId.startsWith("120") },
    { label: "prefix_180", test: (_title, customId) => customId.startsWith("180") },
  ];

  const totals = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const title = (row["Asset Title"] ?? "").trim();
    const customId = (row["Custom ID"] ?? "").trim();
    const value = Number((row["Partner Revenue"] ?? "0").trim()) || 0;
    total += value;
    for (const pattern of patterns) {
      if (pattern.test(title, customId)) {
        totals.set(pattern.label, (totals.get(pattern.label) ?? 0) + value);
      }
    }
  }

  console.log(`[AnalyzeProbeTitlePatterns] total=${total.toFixed(12)}`);
  for (const pattern of patterns) {
    console.log(`${pattern.label}\t${(totals.get(pattern.label) ?? 0).toFixed(12)}`);
  }
}

run();
