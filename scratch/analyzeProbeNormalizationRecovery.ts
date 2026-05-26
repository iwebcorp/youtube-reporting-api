import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

type Row = Record<string, string>;

interface RecoveryStats {
  rows: number;
  revenue: number;
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

function isValidAssetId(value: string): boolean {
  return /^A\d+$/.test(value.trim());
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function buildIndex(records: AssetMetadata[], picker: (record: AssetMetadata) => string): Map<string, AssetMetadata[]> {
  const index = new Map<string, AssetMetadata[]>();
  for (const record of records) {
    const key = clean(picker(record));
    if (!key) continue;
    const bucket = index.get(key) ?? [];
    bucket.push(record);
    index.set(key, bucket);
  }
  return index;
}

function buildCompositeIndex(
  records: AssetMetadata[],
  pickerA: (record: AssetMetadata) => string,
  pickerB: (record: AssetMetadata) => string,
): Map<string, AssetMetadata[]> {
  const index = new Map<string, AssetMetadata[]>();
  for (const record of records) {
    const keyA = clean(pickerA(record));
    const keyB = clean(pickerB(record));
    if (!keyA || !keyB) continue;
    const composite = `${keyA}|${keyB}`;
    const bucket = index.get(composite) ?? [];
    bucket.push(record);
    index.set(composite, bucket);
  }
  return index;
}

function addStat(map: Map<string, RecoveryStats>, key: string, revenue: number): void {
  const stat = map.get(key) ?? { rows: 0, revenue: 0 };
  stat.rows += 1;
  stat.revenue += revenue;
  map.set(key, stat);
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/red_pub_26_3");
  const cachePath = path.resolve(process.cwd(), process.argv[3] ?? "asset_metadata_cache_split.json");
  const revenueColumn = process.argv[4] ?? "Partner Revenue";

  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseWorksheet(sheetXml, loadSharedStrings(sharedStringsXml));
  const metadataMap = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetMetadata>;
  const records = Object.values(metadataMap).filter((record) => record.sourceCategory === "Publishing");

  const byCustomId = buildIndex(records, (record) => record.customId);
  const byIsrc = buildIndex(records, (record) => record.isrc);
  const byTitle = buildIndex(records, (record) => record.title);
  const byCustomIdIsrc = buildCompositeIndex(records, (record) => record.customId, (record) => record.isrc);
  const byCustomIdTitle = buildCompositeIndex(records, (record) => record.customId, (record) => record.title);

  const recovered = new Map<string, RecoveryStats>();
  let invalidRows = 0;
  let invalidRevenue = 0;
  let recoveredRows = 0;
  let recoveredRevenue = 0;
  const unresolvedSamples: Array<Record<string, string | number>> = [];

  for (const row of rows) {
    const assetId = clean(row["Asset ID"]);
    if (isValidAssetId(assetId)) continue;

    const customId = clean(row["Custom ID"]);
    const title = clean(row["Asset Title"]);
    const revenue = toNumber(row[revenueColumn]);
    invalidRows += 1;
    invalidRevenue += revenue;

    let strategy = "";
    let matched: AssetMetadata[] | undefined;

    if (isValidAssetId(title)) {
      strategy = "title_has_asset_id";
      matched = [{ ...metadataMap[title], assetId: title } as AssetMetadata];
    } else if (customId && assetId) {
      const composite = `${customId}|${assetId}`;
      const compositeTitle = `${customId}|${title}`;
      const byCustomIdIsrcMatch = byCustomIdIsrc.get(composite);
      const byCustomIdTitleMatch = byCustomIdTitle.get(compositeTitle);
      if (byCustomIdIsrcMatch?.length === 1) {
        strategy = "custom_id_plus_assetid_isrc";
        matched = byCustomIdIsrcMatch;
      } else if (byCustomIdTitleMatch?.length === 1) {
        strategy = "custom_id_plus_title";
        matched = byCustomIdTitleMatch;
      }
    }

    if (!matched && assetId) {
      const isrcMatch = byIsrc.get(assetId);
      if (isrcMatch?.length === 1) {
        strategy = "assetid_isrc";
        matched = isrcMatch;
      }
    }

    if (!matched && title) {
      const titleIsrcMatch = byIsrc.get(title);
      if (titleIsrcMatch?.length === 1) {
        strategy = "title_isrc";
        matched = titleIsrcMatch;
      }
    }

    if (!matched && customId) {
      const customIdMatch = byCustomId.get(customId);
      if (customIdMatch?.length === 1) {
        strategy = "custom_id_unique";
        matched = customIdMatch;
      }
    }

    if (!matched && title) {
      const titleMatch = byTitle.get(title);
      if (titleMatch?.length === 1) {
        strategy = "title_unique";
        matched = titleMatch;
      }
    }

    if (matched?.length === 1) {
      recoveredRows += 1;
      recoveredRevenue += revenue;
      addStat(recovered, strategy, revenue);
      continue;
    }

    if (unresolvedSamples.length < 30) {
      unresolvedSamples.push({
        assetId,
        customId,
        title,
        ownership: clean(row["Ownership Percentage"]),
        revenue,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        probeDir,
        cachePath,
        publishingMetadataRecords: records.length,
        invalidRows,
        invalidRevenue,
        recoveredRows,
        recoveredRevenue,
        recoveryBreakdown: Object.fromEntries(
          [...recovered.entries()]
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .map(([key, value]) => [key, value]),
        ),
        unresolvedRevenue: invalidRevenue - recoveredRevenue,
        unresolvedRows: invalidRows - recoveredRows,
        unresolvedSamples,
      },
      null,
      2,
    ),
  );
}

run();
