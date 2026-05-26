import * as fs from "fs";
import * as path from "path";
import { AssetClassifier } from "../src/assetClassifier.js";
import { parseCsvRows } from "../src/reporting/parsers.js";

type Row = Record<string, string>;

function fileNameMatchesYearMonth(fileName: string, yearMonth: string): boolean {
  const firstDateToken = fileName.match(/\d{4}-\d{2}|\d{8}|\d{6}/)?.[0];
  return firstDateToken ? firstDateToken.replace(/-/g, "").startsWith(yearMonth) : false;
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
    return Array.from(cellMap.values()).includes("Custom ID");
  });
  if (headerRowIndex < 0) {
    return [];
  }
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
      if (header) {
        row[header] = cellMap.get(column) ?? "";
      }
    }
    rows.push(row);
  }
  return rows;
}

function loadProbeCustomIds(probeDir: string): Set<string> {
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
  return new Set(rows.map((row) => (row["Custom ID"] ?? "").trim()).filter(Boolean));
}

async function run(): Promise<void> {
  const yearMonth = process.argv[2] ?? "202604";
  const probeDir = path.resolve(process.cwd(), process.argv[3] ?? "scratch/xlsx_probe/ad_pub_26_3");
  const restrictCountry = process.argv[4] ?? "KR";
  const reportDir = path.resolve(process.cwd(), "reports");
  const probeCustomIds = loadProbeCustomIds(probeDir);

  const classifier = new AssetClassifier();
  await classifier.initialize({
    neighboringDir: path.resolve(process.cwd(), "인접"),
    publishingDir: path.resolve(process.cwd(), "저작"),
    cacheFile: path.resolve(process.cwd(), "asset_metadata_cache_split.json"),
  });

  const files = fs
    .readdirSync(reportDir)
    .filter((fileName) => fileName.endsWith("content_owner_asset_estimated_revenue_a1.csv"))
    .filter((fileName) => fileNameMatchesYearMonth(fileName, yearMonth))
    .sort();

  let total = 0;
  for (const fileName of files) {
    const rows = await parseCsvRows(path.join(reportDir, fileName));
    for (const row of rows) {
      if (restrictCountry && (row["country_code"] ?? "").trim() !== restrictCountry) {
        continue;
      }
      const assetId = (row["asset_id"] ?? "").trim();
      if (!assetId) {
        continue;
      }
      const metadata = classifier.getMetadata(assetId);
      const customId = (metadata.customId ?? "").trim();
      if (!probeCustomIds.has(customId)) {
        continue;
      }
      total += Number((row["estimated_partner_ad_revenue"] ?? "0").trim()) || 0;
    }
  }

  console.log(
    `[SumEstimatedRevenueByProbeCustomIds] yearMonth=${yearMonth} probeDir=${probeDir} country=${restrictCountry} customIds=${probeCustomIds.size} total=${total.toFixed(12)}`,
  );
}

run().catch((error) => {
  console.error("[SumEstimatedRevenueByProbeCustomIds] Failed.", error);
  process.exitCode = 1;
});
