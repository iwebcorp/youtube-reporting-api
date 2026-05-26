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

function accumulate(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const revenueColumn = process.argv[3] ?? "Partner Revenue";
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));

  const total = rows.reduce((sum, row) => sum + toNumber(row[revenueColumn]), 0);
  const byCountry = new Map<string, number>();
  const byOffer = new Map<string, number>();
  const byRightType = new Map<string, number>();
  const byClaimType = new Map<string, number>();
  const byOwnership = new Map<string, number>();
  const byRightShareShape = new Map<string, number>();
  let blankAssetIdTotal = 0;
  let blankCustomIdTotal = 0;
  let partialOwnershipTotal = 0;
  let nonKrTotal = 0;

  for (const row of rows) {
    const revenue = toNumber(row[revenueColumn]);
    const country = (row["Country"] ?? "").trim() || "(blank)";
    const offer = (row["Offer"] ?? "").trim() || "(blank)";
    const rightType = (row["Composition Right Type"] ?? "").trim() || "(blank)";
    const claimType = (row["Music Claim Type"] ?? "").trim() || (row["Claim Type"] ?? "").trim() || "(blank)";
    const ownership = (row["Ownership Percentage"] ?? "").trim() || "(blank)";
    const assetId = (row["Asset ID"] ?? "").trim();
    const customId = (row["Custom ID"] ?? "").trim();

    accumulate(byCountry, country, revenue);
    accumulate(byOffer, offer, revenue);
    accumulate(byRightType, rightType, revenue);
    accumulate(byClaimType, claimType, revenue);
    accumulate(byOwnership, ownership, revenue);
    accumulate(byRightShareShape, `${claimType}|${rightType}|${ownership}`, revenue);

    if (!assetId) blankAssetIdTotal += revenue;
    if (!customId) blankCustomIdTotal += revenue;
    if (ownership && ownership !== "100.00" && ownership !== "100" && ownership !== "(blank)") partialOwnershipTotal += revenue;
    if (country !== "KR" && country !== "(blank)") nonKrTotal += revenue;
  }

  const top = (map: Map<string, number>, limit = 15) =>
    Object.fromEntries([...map.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit));

  console.log(
    JSON.stringify(
      {
        probeDir,
        revenueColumn,
        rowCount: rows.length,
        total,
        blankAssetIdTotal,
        blankCustomIdTotal,
        partialOwnershipTotal,
        nonKrTotal,
        byCountry: top(byCountry),
        byOffer: top(byOffer),
        byRightType: top(byRightType),
        byClaimType: top(byClaimType),
        byOwnership: top(byOwnership),
        byRightShareShape: top(byRightShareShape, 20),
      },
      null,
      2,
    ),
  );
}

run();
