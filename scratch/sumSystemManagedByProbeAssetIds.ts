import * as fs from "fs";
import * as path from "path";
import { parseCsvRows } from "../src/reporting/parsers.js";

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

function loadProbeAssetIds(probeDir: string): Set<string> {
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
  return new Set(rows.map((row) => (row["Asset ID"] ?? "").trim()).filter(Boolean));
}

function fileNameMatchesYearMonth(fileName: string, yearMonth: string): boolean {
  const firstDateToken = fileName.match(/\d{4}-\d{2}|\d{8}|\d{6}/)?.[0];
  return firstDateToken ? firstDateToken.replace(/-/g, "").startsWith(yearMonth) : false;
}

function toNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function run(): Promise<void> {
  const yearMonth = process.argv[2] ?? "202604";
  const probeDir = path.resolve(process.cwd(), process.argv[3] ?? "scratch/xlsx_probe/red_pub_26_3");
  const fileToken = process.argv[4] ?? "music_content_owner_asset_red_revenue_raw_a1";
  const revenueColumn = process.argv[5] ?? "partner_revenue_usd";
  const systemManagedDir = path.resolve(process.cwd(), "reports/system-managed");
  const probeAssetIds = loadProbeAssetIds(probeDir);

  const files = fs
    .readdirSync(systemManagedDir)
    .filter((fileName) => fileName.endsWith(".csv"))
    .filter((fileName) => fileNameMatchesYearMonth(fileName, yearMonth))
    .filter((fileName) => fileName.includes(fileToken))
    .sort();

  let total = 0;
  let matchedRows = 0;
  const byAdjustment = new Map<string, number>();
  const byCountry = new Map<string, number>();

  for (const fileName of files) {
    const rows = await parseCsvRows(path.join(systemManagedDir, fileName));
    for (const row of rows) {
      const assetId = (row["asset_id"] ?? "").trim();
      if (!probeAssetIds.has(assetId)) continue;
      const revenue = toNumber(row[revenueColumn] ?? row["partner_revenue"] ?? row["partner_revenue_usd"]);
      total += revenue;
      matchedRows += 1;
      const adjustmentType = (row["adjustment_type"] ?? "None").trim() || "None";
      const country = (row["country"] ?? row["country_code"] ?? "XX").trim() || "XX";
      byAdjustment.set(adjustmentType, (byAdjustment.get(adjustmentType) ?? 0) + revenue);
      byCountry.set(country, (byCountry.get(country) ?? 0) + revenue);
    }
  }

  console.log(
    JSON.stringify(
      {
        yearMonth,
        probeDir,
        fileToken,
        revenueColumn,
        probeAssetIds: probeAssetIds.size,
        matchedRows,
        total,
        byAdjustment: Object.fromEntries([...byAdjustment.entries()].sort((a, b) => b[1] - a[1])),
        byCountry: Object.fromEntries([...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("[SumSystemManagedByProbeAssetIds] Failed.", error);
  process.exitCode = 1;
});
