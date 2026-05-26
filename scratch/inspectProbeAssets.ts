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
  const ids = new Set((process.argv[3] ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
  const byAsset = new Map<
    string,
    {
      title: string;
      customId: string;
      claimTypes: Set<string>;
      rightTypes: Set<string>;
      revenue: number;
      rowCount: number;
    }
  >();

  for (const row of rows) {
    const assetId = (row["Asset ID"] ?? "").trim();
    if (!ids.has(assetId)) continue;
    const entry =
      byAsset.get(assetId) ??
      {
        title: (row["Asset Title"] ?? "").trim(),
        customId: (row["Custom ID"] ?? "").trim(),
        claimTypes: new Set<string>(),
        rightTypes: new Set<string>(),
        revenue: 0,
        rowCount: 0,
      };
    entry.claimTypes.add((row["Music Claim Type"] ?? "").trim());
    entry.rightTypes.add((row["Composition Right Type"] ?? "").trim());
    entry.revenue += Number((row["Partner Revenue"] ?? "0").trim()) || 0;
    entry.rowCount += 1;
    byAsset.set(assetId, entry);
  }

  for (const [assetId, entry] of byAsset.entries()) {
    console.log(
      JSON.stringify(
        {
          assetId,
          title: entry.title,
          customId: entry.customId,
          claimTypes: [...entry.claimTypes],
          rightTypes: [...entry.rightTypes],
          revenue: entry.revenue,
          rowCount: entry.rowCount,
        },
        null,
        2,
      ),
    );
  }
}

run();
