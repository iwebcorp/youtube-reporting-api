import * as fs from "fs";
import * as path from "path";

type Row = Record<string, string>;

interface CandidateRulesFile {
  adjustment: {
    upscaleAssetIds: string[];
    dropAssetIds: string[];
  };
  subscription: {
    exclusionKeys: string[];
  };
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
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

function readProbeRows(probeDir: string): Row[] {
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  return parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
}

function run(): void {
  const rulesPath = path.resolve(process.cwd(), process.argv[2] ?? "publishing_royalty_202604_candidate_rules.json");
  const adjDir = path.resolve(process.cwd(), process.argv[3] ?? "scratch/xlsx_probe/ad_pub_adj");
  const subDir = path.resolve(process.cwd(), process.argv[4] ?? "scratch/xlsx_probe/red_pub_26_3");

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8")) as CandidateRulesFile;
  const adjustmentIds = new Set([...rules.adjustment.upscaleAssetIds, ...rules.adjustment.dropAssetIds]);
  const subscriptionIds = new Set(rules.subscription.exclusionKeys.map((key) => clean(key.split("|")[1])));

  const adjRows = readProbeRows(adjDir)
    .filter((row) => adjustmentIds.has(clean(row["Asset ID"])))
    .map((row) => ({
      assetId: clean(row["Asset ID"]),
      title: clean(row["Asset Title"]),
      assetLabels: clean(row["Asset Labels"]),
      assetType: clean(row["Asset Type"]),
      customId: clean(row["Custom ID"]),
      isrc: clean(row["ISRC"]),
      iswc: clean(row["ISWC"]),
      writers: clean(row["Writers"]),
      adjustmentType: clean(row["Adjustment Type"]),
      country: clean(row["Country"]),
    }));

  const subRows = readProbeRows(subDir)
    .filter((row) => subscriptionIds.has(clean(row["Asset ID"])))
    .map((row) => ({
      assetId: clean(row["Asset ID"]),
      title: clean(row["Asset Title"]),
      assetLabels: clean(row["Asset Labels"]),
      assetType: clean(row["Asset Type"]),
      customId: clean(row["Custom ID"]),
      isrc: clean(row["ISRC"]),
      iswc: clean(row["ISWC"]),
      writers: clean(row["Writers"]),
      ownership: clean(row["Ownership Percentage"]),
      country: clean(row["Country"]),
    }));

  console.log(JSON.stringify({ adjustment: adjRows, subscription: subRows }, null, 2));
}

run();
