import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
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
      if (!header) {
        continue;
      }
      row[header] = cellMap.get(column) ?? "";
    }
    rows.push(row);
  }

  return rows;
}

async function loadRows(inputPath: string): Promise<{ rows: Row[]; valueKey: string }> {
  const stat = fs.statSync(inputPath);
  let rows: Row[] = [];
  if (stat.isDirectory()) {
    const sharedStringsXml = fs.readFileSync(path.join(inputPath, "xl/sharedStrings.xml"), "utf-8");
    const sheetXml = fs.readFileSync(path.join(inputPath, "xl/worksheets/sheet1.xml"), "utf-8");
    rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
  } else {
    const rawText = fs.readFileSync(inputPath, "utf-8");
    const normalizedText = rawText.startsWith("Asset Summary\r\n")
      ? rawText.slice("Asset Summary\r\n".length)
      : rawText.startsWith("Asset Summary\n")
        ? rawText.slice("Asset Summary\n".length)
        : rawText;
    rows = parse(normalizedText, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as Row[];
  }

  const firstDataRow = rows.find(
    (row) =>
      "Partner Revenue" in row ||
      "AllocatedAmount" in row ||
      "AllocatedNetRevenue" in row,
  );
  const valueKey =
    firstDataRow && "Partner Revenue" in firstDataRow
      ? "Partner Revenue"
      : firstDataRow && "AllocatedAmount" in firstDataRow
        ? "AllocatedAmount"
        : firstDataRow && "AllocatedNetRevenue" in firstDataRow
          ? "AllocatedNetRevenue"
          : "";
  if (!valueKey) {
    throw new Error(`Unsupported input: ${inputPath}`);
  }
  return { rows: firstDataRow ? rows.filter((row) => valueKey in row) : rows, valueKey };
}

function summarize(rows: Row[], valueKey: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const customId = (row["Custom ID"] ?? "").trim();
    const prefix = customId.slice(0, 3) || "(blank)";
    const value = Number((row[valueKey] ?? "0").trim()) || 0;
    totals.set(prefix, (totals.get(prefix) ?? 0) + value);
  }
  return totals;
}

async function run(): Promise<void> {
  const leftPath = path.resolve(process.cwd(), process.argv[2]!);
  const rightPath = path.resolve(process.cwd(), process.argv[3]!);
  const left = await loadRows(leftPath);
  const right = await loadRows(rightPath);
  const leftTotals = summarize(left.rows, left.valueKey);
  const rightTotals = summarize(right.rows, right.valueKey);
  const prefixes = Array.from(new Set([...leftTotals.keys(), ...rightTotals.keys()])).sort();

  console.log(`prefix\tleft\tright\tdiff`);
  for (const prefix of prefixes) {
    const leftValue = leftTotals.get(prefix) ?? 0;
    const rightValue = rightTotals.get(prefix) ?? 0;
    const diff = rightValue - leftValue;
    console.log(`${prefix}\t${leftValue.toFixed(12)}\t${rightValue.toFixed(12)}\t${diff.toFixed(12)}`);
  }
}

run().catch((error) => {
  console.error("[CompareCustomIdPrefixes] Failed.", error);
  process.exitCode = 1;
});
