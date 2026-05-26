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

function categoryOf(row: Row): string {
  const assetId = (row["Asset ID"] ?? "").trim();
  const title = (row["Asset Title"] ?? "").trim();
  const customId = (row["Custom ID"] ?? "").trim();
  if (/^A\d+$/.test(assetId)) return "valid_asset_id";
  if (/^A\d+$/.test(title)) return "title_has_asset_id";
  if (/^[A-Z]{3,5}\d{7,}$/.test(assetId)) return "asset_id_looks_like_isrc";
  if (/^[A-Z]{3,5}\d{7,}$/.test(title)) return "title_looks_like_isrc";
  if (/^\d{6,}$/.test(assetId)) return "asset_id_numeric";
  if (/[,|]/.test(assetId)) return "asset_id_looks_like_names";
  if (assetId.length <= 3) return "asset_id_too_short";
  if (customId && /^\d+$/.test(customId)) return "custom_id_only";
  return "other_invalid";
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const revenueColumn = process.argv[3] ?? "Partner Revenue";
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));

  const counts = new Map<string, { rows: number; revenue: number; samples: Array<Record<string, string | number>> }>();
  for (const row of rows) {
    const assetId = (row["Asset ID"] ?? "").trim();
    if (/^A\d+$/.test(assetId)) continue;
    const category = categoryOf(row);
    const revenue = toNumber(row[revenueColumn]);
    const entry = counts.get(category) ?? { rows: 0, revenue: 0, samples: [] };
    entry.rows += 1;
    entry.revenue += revenue;
    if (entry.samples.length < 10) {
      entry.samples.push({
        assetId,
        customId: (row["Custom ID"] ?? "").trim(),
        title: (row["Asset Title"] ?? "").trim(),
        ownership: (row["Ownership Percentage"] ?? "").trim(),
        revenue,
      });
    }
    counts.set(category, entry);
  }

  console.log(
    JSON.stringify(
      Object.fromEntries(
        [...counts.entries()]
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .map(([category, value]) => [category, value]),
      ),
      null,
      2,
    ),
  );
}

run();
