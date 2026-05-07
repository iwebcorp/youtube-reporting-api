import * as fs from "fs";
import * as path from "path";
import { inflateRawSync } from "zlib";
import { pathToFileURL } from "url";
import iconv from "iconv-lite";
import { AssetClassifier } from "./assetClassifier.js";
import {
  parseAudioTierDetailFiles,
  buildPublishingUsageCacheFromReports,
  parseCsvRows,
  parsePublishingFinancialFiles,
  parseRedSummaryFiles,
} from "./reporting/parsers.js";
import { createPublishingWriters, closeWriters } from "./reporting/writers.js";
import {
  csvEscape,
  listMonthlyReportGroups,
  listMonthlySystemManagedFiles,
  loadPublishingUsageCache,
  parseCliArgs,
  resolveExtractionConfig,
} from "./reporting/utils.js";
import type {
  AudioTierDetailEntry,
  CsvRow,
  MonthlySummaryEntry,
  PublishingFinancialEntry,
  PublishingUsageCacheEntry,
  PublishingWriters,
  RedSummaryEntry,
} from "./reporting/types.js";

interface MonthlyAdSummary {
  assetId: string;
  country: string;
  sourceTitle: string;
  sourceCustomId: string;
  sourceIsrc: string;
  sourceAssetType: string;
  adRevenue: number;
  partnerRevenue: number;
  views: number;
  watchPageViews: number;
  embeddedViews: number;
  channelPageViews: number;
  liveViews: number;
  onDemandViews: number;
  adEnabledViews: number;
  adsenseRevenue: number;
  doubleclickServedYouTubeSoldRevenue: number;
  doubleclickServedPartnerSoldRevenue: number;
  partnerServedPartnerSoldRevenue: number;
  partnerAdsenseRevenue: number;
  partnerDoubleclickServedYouTubeSoldRevenue: number;
  partnerDoubleclickServedPartnerSoldRevenue: number;
  partnerPartnerServedPartnerSoldRevenue: number;
}

type WorkbookRow = Record<string, string>;
interface ParsedWorksheet {
  headerRowIndex: number;
  headerOrder: string[];
  headers: string[];
  rows: WorkbookRow[];
  rawRows: Map<string, string>[];
}

type PublishingDirectSourceKind = "dailyAd" | "adjustment" | "monthly" | "ddex";

interface PublishingDirectSourceExpansionProfile {
  kind: PublishingDirectSourceKind;
  orderedHeaders: readonly string[];
}

const PUBLISHING_DAILY_AD_HEADERS = [
  "Asset ID",
  "Asset Labels",
  "Custom ID",
  "ISWC",
  "HFA Song Code",
  "Asset Title",
  "Writers",
  "Music Claim Type",
  "Composition Right Type",
  "Ownership Percentage",
  "Country",
  "Owned Views",
  "Owned Views : Watch Page",
  "Owned Views : Embedded Player",
  "Owned Views : Channel Page",
  "Owned Views : Live",
  "Owned Views : On Demand",
  "Owned Views : Ad-Enabled",
  "YouTube Revenue Split : AdSense Served YouTube Sold",
  "YouTube Revenue Split : DoubleClick Served YouTube Sold",
  "YouTube Revenue Split : DoubleClick Served Partner Sold",
  "YouTube Revenue Split : Partner Served Partner Sold",
  "YouTube Revenue Split",
  "Partner Revenue : AdSense Served YouTube Sold",
  "Partner Revenue : DoubleClick Served YouTube Sold",
  "Partner Revenue : DoubleClick Served Partner Sold",
  "Partner Revenue : Partner Served Partner Sold",
  "Partner Revenue",
] as const;

const PUBLISHING_ADJUSTMENT_HEADERS = [
  "Adjustment Type",
  "Day",
  "Country",
  "Asset ID",
  "Asset Title",
  "Asset Labels",
  "Asset Channel ID",
  "Asset Type",
  "Custom ID",
  "ISRC",
  "ISWC",
  "HFA Song Code",
  "Writers",
  "Owned Views",
  "YouTube Revenue Split : Auction",
  "YouTube Revenue Split : Reserved",
  "YouTube Revenue Split : Partner Sold YouTube Served",
  "YouTube Revenue Split : Partner Sold Partner Served",
  "YouTube Revenue Split",
  "Partner Revenue : Auction",
  "Partner Revenue : Reserved",
  "Partner Revenue : Partner Sold YouTube Served",
  "Partner Revenue : Partner Sold Partner Served",
  "Partner Revenue",
] as const;

const PUBLISHING_MONTHLY_HEADERS = [
  "Adjustment Type",
  "Month",
  "Country",
  "Asset ID",
  "Asset Title",
  "Asset Labels",
  "Custom ID",
  "ISRC",
  "ISWC",
  "HFA Song Code",
  "Writers",
  "Composition Right Type",
  "Ownership Percentage",
  "Claim Quality",
  "Revshare Rate Type",
  "Offer",
  "Owned Views",
  "Monetized Views : Audio",
  "Monetized Views : Audio Visual",
  "Monetized Views",
  "YouTube Revenue Split",
  "Partner Revenue : Pro Rata : Audio",
  "Partner Revenue : Pro Rata : Audio Visual",
  "Partner Revenue : Pro Rata",
  "Partner Revenue : Per Sub Min",
  "Partner Revenue",
] as const;

const PUBLISHING_DIRECT_SOURCE_PROFILES: Record<PublishingDirectSourceKind, PublishingDirectSourceExpansionProfile> = {
  dailyAd: {
    kind: "dailyAd",
    orderedHeaders: PUBLISHING_DAILY_AD_HEADERS,
  },
  adjustment: {
    kind: "adjustment",
    orderedHeaders: PUBLISHING_ADJUSTMENT_HEADERS,
  },
  monthly: {
    kind: "monthly",
    orderedHeaders: PUBLISHING_MONTHLY_HEADERS,
  },
  ddex: {
    kind: "ddex",
    orderedHeaders: [],
  },
};

interface PublishingDirectSources {
  dailyAdCsvPath: string | null;
  dailyAdWorkbookPath: string | null;
  adjustmentCsvPath: string | null;
  adjustmentWorkbookPath: string | null;
  monthlyCsvPath: string | null;
  monthlyWorkbookPath: string | null;
  ddexCsvPath: string | null;
  ddexWorkbookPath: string | null;
}

interface PublishingDirectSourceResolution {
  hasCompleteDirectSource: boolean;
  dailySourcePath: string | null;
  adjustmentSourcePath: string | null;
  monthlySourcePath: string | null;
  ddexSourcePath: string | null;
}

function loadWorkbookEntries(workbookPath: string): Map<string, Buffer> {
  const archive = fs.readFileSync(workbookPath);
  let eocdOffset = -1;
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 65557); index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error(`[Publishing] ZIP end-of-central-directory not found: ${workbookPath}`);
  }

  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, Buffer>();
  let offset = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`[Publishing] Invalid central directory entry in ${workbookPath}`);
    }

    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const fileName = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf-8");

    if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`[Publishing] Invalid local ZIP header in ${workbookPath}: ${fileName}`);
    }

    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const extracted =
      compressionMethod === 0
        ? Buffer.from(compressed)
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : (() => {
              throw new Error(
                `[Publishing] Unsupported ZIP compression method ${compressionMethod} in ${workbookPath}: ${fileName}`,
              );
            })();

    entries.set(fileName, extracted);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function loadSharedStrings(sharedStringsXml: string): string[] {
  const xml = sharedStringsXml;
  return Array.from(xml.matchAll(/<t[^>]*>(.*?)<\/t>/gs), (match) =>
    (match[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

function parseWorksheet(sheetXml: string, sharedStrings: string[]): ParsedWorksheet {
  const xml = sheetXml;
  const rowMatches = Array.from(xml.matchAll(/<row r="(\d+)"[^>]*>(.*?)<\/row>/gs));
  if (rowMatches.length === 0) {
    return {
      headerRowIndex: -1,
      headerOrder: [],
      headers: [],
      rows: [],
      rawRows: [],
    };
  }

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
    return {
      headerRowIndex: -1,
      headerOrder: [],
      headers: [],
      rows: [],
      rawRows: rowMatches.map((rowMatch) => parseRow(rowMatch[2] ?? "")),
    };
  }

  const headerCells = parseRow(rowMatches[headerRowIndex]?.[2] ?? "");
  const headerOrder = Array.from(headerCells.keys());
  const headers = headerOrder.map((column) => headerCells.get(column) ?? "");
  const rows: WorkbookRow[] = [];
  const rawRows: Map<string, string>[] = [];

  for (const rowMatch of rowMatches.slice(headerRowIndex + 1)) {
    const cellMap = parseRow(rowMatch[2] ?? "");
    rawRows.push(cellMap);
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

  return {
    headerRowIndex,
    headerOrder,
    headers,
    rows,
    rawRows,
  };
}

function findSampleWorkbook(sampleDir: string, matcher: (fileName: string) => boolean): string | null {
  if (!fs.existsSync(sampleDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(sampleDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".xlsx"))
    .filter(matcher)
    .sort();

  if (candidates.length === 0) {
    return null;
  }

  return path.join(sampleDir, candidates[0]!);
}

function fileNameMatchesYearMonth(fileName: string, yearMonth: string): boolean {
  return fileName.includes(yearMonth) || fileName.includes(`${yearMonth}01`);
}

function findDirectPublishingCsv(
  publishingDir: string,
  yearMonth: string,
  matcher: (fileName: string) => boolean,
): string | null {
  if (!fs.existsSync(publishingDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(publishingDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".csv"))
    .filter((fileName) => fileNameMatchesYearMonth(fileName, yearMonth))
    .filter(matcher)
    .sort();

  if (candidates.length === 0) {
    return null;
  }

  return path.join(publishingDir, candidates[0]!);
}

function findPublishingDailyAdCsv(publishingDir: string, yearMonth: string): string | null {
  return findDirectPublishingCsv(
    publishingDir,
    yearMonth,
    (fileName) => fileName.startsWith("1.") && fileName.includes("_rev_views_by_asset_"),
  );
}

function findPublishingAdjustmentCsv(publishingDir: string, yearMonth: string): string | null {
  return findDirectPublishingCsv(
    publishingDir,
    yearMonth,
    (fileName) => fileName.startsWith("2.") && fileName.includes("_ADJ_") && fileName.includes("_asset_"),
  );
}

function findPublishingMonthlyCsv(publishingDir: string, yearMonth: string): string | null {
  return findDirectPublishingCsv(
    publishingDir,
    yearMonth,
    (fileName) => fileName.startsWith("3.") && fileName.includes("_red_pubs_rawdata_asset_"),
  );
}

function findPublishingDdexCsv(publishingDir: string, yearMonth: string): string | null {
  return findDirectPublishingCsv(
    publishingDir,
    yearMonth,
    (fileName) => fileName.startsWith("4.") && fileName.toLowerCase().includes("dsr_"),
  );
}

function findPublishingDailyAdWorkbook(sampleDir: string): string | null {
  return findSampleWorkbook(sampleDir, (fileName) => fileName.includes("광고 저작료") && !fileName.includes("조정"));
}

function findPublishingAdjustmentWorkbook(sampleDir: string): string | null {
  return findSampleWorkbook(sampleDir, (fileName) => fileName.includes("광고 저작료") && fileName.includes("조정"));
}

function findPublishingMonthlyWorkbook(sampleDir: string): string | null {
  return findSampleWorkbook(sampleDir, (fileName) => fileName.includes("레드 저작료"));
}

function findPublishingDdexWorkbook(sampleDir: string): string | null {
  return findSampleWorkbook(sampleDir, (fileName) => fileName.includes("오디오서비스"));
}

async function writeDailyAdFromWorkbook(workbookPath: string, writers: PublishingWriters): Promise<number> {
  const entries = loadWorkbookEntries(workbookPath);
  const sharedStringsXml = entries.get("xl/sharedStrings.xml");
  const sheetXml = entries.get("xl/worksheets/sheet1.xml");
  if (!sharedStringsXml || !sheetXml) {
    throw new Error(`[Publishing] Workbook is missing required XML entries: ${workbookPath}`);
  }

  const sharedStrings = loadSharedStrings(sharedStringsXml.toString("utf-8"));
  const worksheet = parseWorksheet(sheetXml.toString("utf-8"), sharedStrings);
  const rows = expandPublishingDirectSourceRows("dailyAd", worksheet.rows);
  return writeOrderedRows(rows, PUBLISHING_DIRECT_SOURCE_PROFILES.dailyAd.orderedHeaders, writers.dailyAd);
}

async function writeDelimitedWorkbook(
  workbookPath: string,
  orderedHeaders: readonly string[],
  writer: NodeJS.WritableStream,
  kind?: PublishingDirectSourceKind,
): Promise<number> {
  const entries = loadWorkbookEntries(workbookPath);
  const sharedStringsXml = entries.get("xl/sharedStrings.xml");
  const sheetXml = entries.get("xl/worksheets/sheet1.xml");
  if (!sharedStringsXml || !sheetXml) {
    throw new Error(`[Publishing] Workbook is missing required XML entries: ${workbookPath}`);
  }

  const sharedStrings = loadSharedStrings(sharedStringsXml.toString("utf-8"));
  const worksheet = parseWorksheet(sheetXml.toString("utf-8"), sharedStrings);
  const expandedRows = kind ? expandPublishingDirectSourceRows(kind, worksheet.rows) : worksheet.rows;
  return writeOrderedRows(expandedRows, orderedHeaders, writer);
}

function writeOrderedRows(
  rows: WorkbookRow[],
  orderedHeaders: readonly string[],
  writer: NodeJS.WritableStream,
): number {
  let rowCount = 0;
  for (const row of rows) {
    const firstHeader = orderedHeaders[0];
    if (firstHeader && !row[firstHeader]) {
      continue;
    }
    const serialized = orderedHeaders.map((header) => csvEscape(row[header] ?? ""));
    writer.write(`${serialized.join(",")}\n`);
    rowCount += 1;
  }
  return rowCount;
}

function decodeTextFile(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString("utf-8");
  }

  const utf8Decoded = buffer.toString("utf-8");
  const cp949Decoded = iconv.decode(buffer, "cp949");
  const score = (text: string) => (text.match(/[가-힣]/g)?.length ?? 0) - ((text.match(/�/g)?.length ?? 0) * 5);
  return score(cp949Decoded) > score(utf8Decoded) ? cp949Decoded : utf8Decoded;
}

function directSourceGroupKey(row: WorkbookRow): string {
  return [
    row["Asset ID"] ?? "",
    row["Custom ID"] ?? "",
    row["Country"] ?? "",
    row["Asset Title"] ?? "",
    row["Writers"] ?? "",
  ].join("|");
}

function directSourceMatchKey(row: WorkbookRow): string {
  return [
    (row["Music Claim Type"] ?? "").trim().toLowerCase(),
    (row["Composition Right Type"] ?? "").trim().toLowerCase(),
  ].join("|");
}

function cloneDirectSourceRow(row: WorkbookRow, orderedHeaders: readonly string[]): WorkbookRow {
  const cloned: WorkbookRow = {};
  for (const header of orderedHeaders) {
    cloned[header] = row[header] ?? "";
  }
  for (const [header, value] of Object.entries(row)) {
    if (!(header in cloned)) {
      cloned[header] = value;
    }
  }
  return cloned;
}

function expandToEmbeddedCoverRows(rows: WorkbookRow[]): WorkbookRow[] {
  const orderedHeaders = PUBLISHING_DIRECT_SOURCE_PROFILES.dailyAd.orderedHeaders;
  const grouped = new Map<string, WorkbookRow[]>();
  for (const row of rows) {
    if (!row["Asset ID"]) {
      continue;
    }
    const key = directSourceGroupKey(row);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const expanded: WorkbookRow[] = [];
  for (const groupRows of grouped.values()) {
    // 2026415 샘플 기준 고정 로직:
    // 저작 1번 직접소스는 Embedded/Cover x Mechanical/Performance 4행 구조를 기준으로 정렬한다.
    // 금액, claim type, right type은 직접소스 원본 행에서 그대로 복제하고, 계산으로 재구성하지 않는다.
    const preferredOrder = [
      "embedded|mechanical",
      "embedded|performance",
      "cover|mechanical",
      "cover|performance",
    ];
    const unmatched = [...groupRows];
    for (const pattern of preferredOrder) {
      const index = unmatched.findIndex((row) => directSourceMatchKey(row) === pattern);
      if (index < 0) {
        continue;
      }
      expanded.push(cloneDirectSourceRow(unmatched[index]!, orderedHeaders));
      unmatched.splice(index, 1);
    }
    for (const row of unmatched) {
      expanded.push(cloneDirectSourceRow(row, orderedHeaders));
    }
  }

  return expanded;
}

function expandPublishingAdjustmentRows(rows: WorkbookRow[]): WorkbookRow[] {
  // Structure prepared for publishing 2 direct-source normalization.
  return rows.map((row) => cloneDirectSourceRow(row, PUBLISHING_DIRECT_SOURCE_PROFILES.adjustment.orderedHeaders));
}

function expandPublishingMonthlyRows(rows: WorkbookRow[]): WorkbookRow[] {
  // Structure prepared for publishing 3 direct-source normalization.
  return rows.map((row) => cloneDirectSourceRow(row, PUBLISHING_DIRECT_SOURCE_PROFILES.monthly.orderedHeaders));
}

function expandPublishingDirectSourceRows(kind: PublishingDirectSourceKind, rows: WorkbookRow[]): WorkbookRow[] {
  switch (kind) {
    case "dailyAd":
      return expandToEmbeddedCoverRows(rows);
    case "adjustment":
      return expandPublishingAdjustmentRows(rows);
    case "monthly":
      return expandPublishingMonthlyRows(rows);
    case "ddex":
      return rows;
    default:
      return rows;
  }
}

async function writeDelimitedCsvSource(
  filePath: string,
  orderedHeaders: readonly string[],
  writer: NodeJS.WritableStream,
  kind?: PublishingDirectSourceKind,
): Promise<number> {
  const rawText = decodeTextFile(filePath).replace(/\r\n/g, "\n");
  const normalizedText = rawText.startsWith("Asset Summary\n") ? rawText.slice("Asset Summary\n".length) : rawText;
  const tempFilePath = path.join(path.dirname(filePath), `.codex_tmp_${path.basename(filePath)}.${process.pid}.csv`);
  fs.writeFileSync(tempFilePath, normalizedText, "utf-8");

  try {
    const rows = await parseCsvRows(tempFilePath, { encoding: "auto" });
    const expandedRows = kind ? expandPublishingDirectSourceRows(kind, rows) : rows;
    return writeOrderedRows(expandedRows, orderedHeaders, writer);
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

function columnNameToIndex(columnName: string): number {
  let value = 0;
  for (const char of columnName) {
    value = (value * 26) + (char.charCodeAt(0) - 64);
  }
  return value;
}

async function writeDdexWorkbook(workbookPath: string, writer: NodeJS.WritableStream): Promise<number> {
  const entries = loadWorkbookEntries(workbookPath);
  const sharedStringsXml = entries.get("xl/sharedStrings.xml");
  const sheetXml = entries.get("xl/worksheets/sheet1.xml");
  if (!sharedStringsXml || !sheetXml) {
    throw new Error(`[Publishing] Workbook is missing required XML entries: ${workbookPath}`);
  }

  const sharedStrings = loadSharedStrings(sharedStringsXml.toString("utf-8"));
  const worksheet = parseWorksheet(sheetXml.toString("utf-8"), sharedStrings);
  const rawRows = worksheet.headerRowIndex >= 0
    ? [new Map(worksheet.headerOrder.map((column, index) => [column, worksheet.headers[index] ?? ""])), ...worksheet.rawRows]
    : worksheet.rawRows;

  let rowCount = 0;
  for (const row of rawRows) {
    const orderedColumns = Array.from(row.keys()).sort((left, right) => columnNameToIndex(left) - columnNameToIndex(right));
    if (orderedColumns.length === 0) {
      continue;
    }
    const lastIndex = columnNameToIndex(orderedColumns[orderedColumns.length - 1] ?? "A");
    const values: string[] = [];
    for (let index = 1; index <= lastIndex; index += 1) {
      const columnName = (() => {
        let current = index;
        let output = "";
        while (current > 0) {
          const remainder = (current - 1) % 26;
          output = String.fromCharCode(65 + remainder) + output;
          current = Math.floor((current - 1) / 26);
        }
        return output;
      })();
      values.push(row.get(columnName) ?? "");
    }
    writer.write(`${values.join("\t")}\n`);
    rowCount += 1;
  }
  return rowCount;
}

async function writeDdexCsvSource(filePath: string, writer: NodeJS.WritableStream): Promise<number> {
  const normalizedText = decodeTextFile(filePath).replace(/\r\n/g, "\n");
  writer.write(normalizedText.endsWith("\n") ? normalizedText : `${normalizedText}\n`);
  return normalizedText.split("\n").filter((line) => line.length > 0).length;
}

function resolvePublishingDirectSources(publishingDir: string, yearMonth: string): PublishingDirectSources {
  return {
    dailyAdCsvPath: findPublishingDailyAdCsv(publishingDir, yearMonth),
    dailyAdWorkbookPath: null,
    adjustmentCsvPath: findPublishingAdjustmentCsv(publishingDir, yearMonth),
    adjustmentWorkbookPath: null,
    monthlyCsvPath: findPublishingMonthlyCsv(publishingDir, yearMonth),
    monthlyWorkbookPath: null,
    ddexCsvPath: findPublishingDdexCsv(publishingDir, yearMonth),
    ddexWorkbookPath: null,
  };
}

function getPublishingDirectSourceResolution(directSources: PublishingDirectSources): PublishingDirectSourceResolution {
  const dailySourcePath = directSources.dailyAdCsvPath;
  const adjustmentSourcePath = directSources.adjustmentCsvPath;
  const monthlySourcePath = directSources.monthlyCsvPath;
  const ddexSourcePath = directSources.ddexCsvPath;

  return {
    hasCompleteDirectSource: Boolean(dailySourcePath && adjustmentSourcePath && monthlySourcePath && ddexSourcePath),
    dailySourcePath,
    adjustmentSourcePath,
    monthlySourcePath,
    ddexSourcePath,
  };
}

function loadPublishingAssetIds(): Set<string> {
  const filePath = path.resolve(process.cwd(), "publishing_asset_ids.json");
  if (!fs.existsSync(filePath)) {
    console.warn(`[Publishing] Missing publishing asset id file: ${filePath}`);
    return new Set<string>();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn(`[Publishing] Invalid publishing asset id file: ${filePath}`);
      return new Set<string>();
    }
    return new Set(parsed.map((value) => String(value).trim()).filter(Boolean));
  } catch (error) {
    console.warn(`[Publishing] Failed to read publishing asset ids from ${filePath}`, error);
    return new Set<string>();
  }
}

function isPublishingRecord(classifier: AssetClassifier, publishingAssetIds: Set<string>, assetId: string): boolean {
  if (publishingAssetIds.has(assetId)) {
    return true;
  }

  const metadata = classifier.getMetadata(assetId);
  if (classifier.classify(assetId) === "Publishing") {
    return true;
  }

  if (!metadata.isrc && (metadata.writers !== "Unidentified Writers" || metadata.artist !== "Various Artists")) {
    return true;
  }

  return false;
}

function buildMonthlyAdSummary(
  financialMap: Map<string, PublishingFinancialEntry>,
  usageMap: Map<string, PublishingUsageCacheEntry>,
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
): Map<string, MonthlyAdSummary> {
  const monthlyAdMap = new Map<string, MonthlyAdSummary>();
  for (const financial of financialMap.values()) {
    if (!isPublishingRecord(classifier, publishingAssetIds, financial.assetId)) {
      continue;
    }

    const usage = usageMap.get(`${financial.assetId}|${financial.country}`);
    monthlyAdMap.set(`${financial.assetId}|${financial.country}`, {
      assetId: financial.assetId,
      country: financial.country,
      sourceTitle: financial.sourceTitle,
      sourceCustomId: financial.sourceCustomId,
      sourceIsrc: financial.sourceIsrc,
      sourceAssetType: financial.sourceAssetType,
      adRevenue: financial.totalRevenue,
      partnerRevenue: financial.partnerTotalRevenue,
      views: financial.ownedViews,
      watchPageViews: usage?.watchPageViews ?? 0,
      embeddedViews: usage?.embeddedViews ?? 0,
      channelPageViews: usage?.channelPageViews ?? 0,
      liveViews: usage?.liveViews ?? 0,
      onDemandViews: usage?.onDemandViews ?? financial.ownedViews,
      adEnabledViews: usage?.adEnabledViews ?? financial.ownedViews,
      adsenseRevenue: financial.adsenseRevenue,
      doubleclickServedYouTubeSoldRevenue: financial.doubleclickServedYouTubeSoldRevenue,
      doubleclickServedPartnerSoldRevenue: financial.doubleclickServedPartnerSoldRevenue,
      partnerServedPartnerSoldRevenue: financial.partnerServedPartnerSoldRevenue,
      partnerAdsenseRevenue: financial.partnerAdsenseRevenue,
      partnerDoubleclickServedYouTubeSoldRevenue: financial.partnerDoubleclickServedYouTubeSoldRevenue,
      partnerDoubleclickServedPartnerSoldRevenue: financial.partnerDoubleclickServedPartnerSoldRevenue,
      partnerPartnerServedPartnerSoldRevenue: financial.partnerPartnerServedPartnerSoldRevenue,
    });
  }
  return monthlyAdMap;
}

function writeAdjustmentRow(
  row: CsvRow,
  yearMonth: string,
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  writers: PublishingWriters,
): void {
  const assetId = row["asset_id"]?.trim() ?? "";
  if (!assetId || !isPublishingRecord(classifier, publishingAssetIds, assetId)) {
    return;
  }

  const adjustmentType = row["adjustment_type"]?.trim() ?? "None";
  if (adjustmentType === "None") {
    return;
  }

  const day = row["day"]?.trim() || row["date"]?.trim() || "";
  if (day && !day.startsWith(yearMonth)) {
    return;
  }

  const metadata = classifier.getMetadata(assetId);
  const rowTitle = row["asset_title"]?.trim() ?? row["title"]?.trim() ?? "";
  const rowCustomId = row["custom_id"]?.trim() ?? "";
  const rowIsrc = row["isrc"]?.trim() ?? "";
  const rowIswc = row["iswc"]?.trim() ?? "";
  const rowHfa = row["hfa_song_code"]?.trim() ?? row["hfa"]?.trim() ?? "";
  const rowChannelId = row["asset_channel_id"]?.trim() ?? "";
  const rowAssetType = row["asset_type"]?.trim() ?? "";
  const adjustmentRow = [
    adjustmentType,
    day,
    row["country"]?.trim() || row["country_code"]?.trim() || "XX",
    assetId,
    csvEscape(rowTitle || metadata.title),
    "",
    rowChannelId,
    rowAssetType || metadata.assetType || "Composition",
    rowCustomId || metadata.customId,
    rowIsrc || metadata.isrc,
    rowIswc || metadata.iswc,
    rowHfa || metadata.hfa,
    csvEscape(metadata.writers),
    row["owned_views"]?.trim() || "0",
    row["youtube_revenue_split_auction"]?.trim() || "0",
    row["youtube_revenue_split_reserved"]?.trim() || "0",
    row["youtube_revenue_split_partner_sold_youtube_served"]?.trim() || "0",
    row["youtube_revenue_split_partner_sold_partner_served"]?.trim() || "0",
    row["youtube_revenue_split"]?.trim() || "0",
    row["partner_revenue_auction"]?.trim() || "0",
    row["partner_revenue_reserved"]?.trim() || "0",
    row["partner_revenue_partner_sold_youtube_served"]?.trim() || "0",
    row["partner_revenue_partner_sold_partner_served"]?.trim() || "0",
    row["partner_revenue"]?.trim() || "0",
  ];
  writers.dailyAdAdjustment.write(`${adjustmentRow.join(",")}\n`);
}

function writeMonthlyAdSummary(
  monthlyAdMap: Map<string, MonthlyAdSummary>,
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  writers: PublishingWriters,
): void {
  for (const summary of monthlyAdMap.values()) {
    const metadata = classifier.getMetadata(summary.assetId);
    if (!isPublishingRecord(classifier, publishingAssetIds, summary.assetId)) {
      continue;
    }
    const totalViews = summary.views;
    const watchPageViews = summary.watchPageViews;
    const embeddedViews = summary.embeddedViews;
    const channelPageViews = summary.channelPageViews;
    const liveViews = summary.liveViews;
    const onDemandViews = summary.onDemandViews;
    const adEnabledViews = summary.adEnabledViews;
    const adRevenue = summary.adRevenue.toFixed(6);
    const partnerRevenue = summary.partnerRevenue.toFixed(6);
    const adsenseRevenue = summary.adsenseRevenue.toFixed(6);
    const doubleclickServedYouTubeSoldRevenue = summary.doubleclickServedYouTubeSoldRevenue.toFixed(6);
    const doubleclickServedPartnerSoldRevenue = summary.doubleclickServedPartnerSoldRevenue.toFixed(6);
    const partnerServedPartnerSoldRevenue = summary.partnerServedPartnerSoldRevenue.toFixed(6);
    const partnerAdsenseRevenue = summary.partnerAdsenseRevenue.toFixed(6);
    const partnerDoubleclickServedYouTubeSoldRevenue = summary.partnerDoubleclickServedYouTubeSoldRevenue.toFixed(6);
    const partnerDoubleclickServedPartnerSoldRevenue = summary.partnerDoubleclickServedPartnerSoldRevenue.toFixed(6);
    const partnerPartnerServedPartnerSoldRevenue = summary.partnerPartnerServedPartnerSoldRevenue.toFixed(6);

    const title = summary.sourceTitle || metadata.title;
    const customId = summary.sourceCustomId || metadata.customId;
    const isrc = summary.sourceIsrc || metadata.isrc;
    // Raw fallback path does not have a reliable Embedded/Cover classifier yet.
    // Keep claim type explicit as unknown to avoid misleading downstream settlement data.
    const musicClaimType = "unknown";
    const row = [
      summary.assetId,
      "",
      customId,
      metadata.iswc,
      metadata.hfa,
      csvEscape(title),
      csvEscape(metadata.writers),
      musicClaimType,
      metadata.compositionRightType,
      "100.00",
      summary.country,
      String(totalViews),
      String(watchPageViews),
      String(embeddedViews),
      String(channelPageViews),
      String(liveViews),
      String(onDemandViews),
      String(adEnabledViews),
      adsenseRevenue,
      doubleclickServedYouTubeSoldRevenue,
      doubleclickServedPartnerSoldRevenue,
      partnerServedPartnerSoldRevenue,
      adRevenue,
      partnerAdsenseRevenue,
      partnerDoubleclickServedYouTubeSoldRevenue,
      partnerDoubleclickServedPartnerSoldRevenue,
      partnerPartnerServedPartnerSoldRevenue,
      partnerRevenue,
    ];
    writers.dailyAd.write(`${row.join(",")}\n`);
  }
}

function writeMonthlySummary(
  redMap: Map<string, RedSummaryEntry>,
  yearMonth: string,
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  writers: PublishingWriters,
): void {
  for (const summary of redMap.values()) {
    if (!isPublishingRecord(classifier, publishingAssetIds, summary.assetId)) {
      continue;
    }

    const metadata = classifier.getMetadata(summary.assetId);
    const row = [
      summary.adjustmentType,
      yearMonth,
      summary.country,
      summary.assetId,
      csvEscape(metadata.title),
      "",
      metadata.customId,
      metadata.isrc,
      metadata.iswc,
      metadata.hfa,
      csvEscape(metadata.writers),
      metadata.compositionRightType,
      "100.00",
      summary.claimType || "UGC",
      "Unknown",
      summary.offer || "YouTube Premium Individual monthly",
      String(summary.ownedViews),
      String(summary.monetizedViewsAudio),
      String(summary.monetizedViewsAudioVisual),
      String(summary.monetizedViews),
      summary.youtubeRevenueSplit.toFixed(6),
      summary.partnerRevenueProRataAudio.toFixed(6),
      summary.partnerRevenueProRataAudioVisual.toFixed(6),
      summary.partnerRevenueProRata.toFixed(6),
      summary.partnerRevenuePerSubMin.toFixed(6),
      summary.partnerRevenue.toFixed(6),
    ];
    writers.monthlySubscription.write(`${row.join(",")}\n`);
  }
}

// TODO: Move publishing row expansion into a dedicated module once the classification
// source is available. Sample analysis so far shows two dominant shapes:
// - 2-row assets: one claim type with Mechanical/Performance, or Embedded/Cover with one right type
// - 4-row assets: Embedded/Cover x Mechanical/Performance
// The current raw fallback cannot derive those shapes reliably because it lacks the
// upstream Embedded/Cover classification used by the publishing direct exports.
function formatDdexText(value: string): string {
  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

async function loadAudioTierSummaryRow(filePaths: string[], targetCountry: string): Promise<CsvRow | null> {
  for (const filePath of filePaths) {
    const rows = await parseCsvRows(filePath);
    for (const row of rows) {
      if ((row["country"]?.trim() ?? "") === targetCountry) {
        return row;
      }
    }
  }
  return null;
}

function writeDdexDsr(
  details: AudioTierDetailEntry[],
  summaryRow: CsvRow | null,
  classifier: AssetClassifier,
  writers: PublishingWriters,
  yearMonth: string,
): void {
  const startDate = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-01`;
  const endDate = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-31`;
  const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const messageId = String(Date.now()).slice(-8);
  const detailRows = details.filter((detail) => detail.country === "KR");
  const performingSummaryId = "3";
  const mechanicalSummaryId = "4";
  const totalUsages = summaryRow ? Number(summaryRow["partner_playbacks"] ?? 0) : detailRows.reduce((sum, detail) => sum + detail.ownedViews, 0);
  const totalAllocatedAmount = summaryRow ? Number(summaryRow["audio_royalties"] ?? 0) : detailRows.reduce((sum, detail) => sum + detail.partnerRevenue, 0);

  writers.ddexDsr.write(
    [
      "HEAD",
      "dsrf/1.2/1.2/1.1",
      "UgcProfileSRB",
      "1.2",
      messageId,
      createdAt,
      "1",
      "1",
      startDate,
      endDate,
      "PADPIDA2013020802I",
      "YouTube",
      "Usage-HardwareAudioTier-Combined-All",
      "",
      "kwangsoomedia-pla",
      "kwangsoomedia_pla",
    ].join("\t") + "\n",
  );
  writers.ddexDsr.write(
    "#HEAD\tMessageVersion\tProfile\tProfileVersion\tMessageId\tMessageCreatedDateTime\tFileNumber\tNumberOfFiles\tUsageStartDate\tUsageEndDate\tSenderPartyId\tSenderName\tServiceDescription\tRecipientPartyId\tRecipientName\tRepresentedRepertoire\n",
  );
  writers.ddexDsr.write(
    "#GSY09\tSummaryRecordId\tTerritory\tServiceDescription\tUsages\tAllocatedUsages\tAllocatedAmount\tAllocatedNetRevenue\tCurrency\tRightsType\n",
  );
  writers.ddexDsr.write(
    "#SR02\tSummaryRecordId\tDspResourceId\tTitle\tDisplayArtistName\tDisplayArtistPartyId\tISRC\tDspWorkId\tMusicalWorkTitle\tISWC\tComposerAuthor\tComposerAuthorPartyId\tUsages\tValidityPeriodStart\tValidityPeriodEnd\tContentCategory\tRightsControllerWorkID\tRightShare%\tRightType\tAllocatedNetRevenue\tAllocatedAmount\n",
  );
  writers.ddexDsr.write("#SRFO\tNumberOfLinesInReport\tNumberOfSummaryRecords\n");

  writers.ddexDsr.write(
    ["GSY09", mechanicalSummaryId, "KR", "Usage-HardwareAudioTier-Music-All", String(totalUsages), String(totalUsages), totalAllocatedAmount.toFixed(2), "0.00", "USD", "MechanicalRight"].join("\t") + "\n",
  );
  writers.ddexDsr.write(
    ["GSY09", performingSummaryId, "KR", "Usage-HardwareAudioTier-Music-All", String(totalUsages), String(totalUsages), totalAllocatedAmount.toFixed(2), "0.00", "USD", "PerformingRight"].join("\t") + "\n",
  );

  for (const detail of detailRows) {
    const metadata = classifier.getMetadata(detail.assetId);
    const title = formatDdexText(detail.title || metadata.title);
    const displayArtistName = formatDdexText(
      (detail.artist || (metadata.artist && metadata.artist !== "Various Artists" ? metadata.artist : metadata.writers)) || metadata.writers,
    );
    const isrc = detail.isrc || metadata.isrc;
    const dspWorkId = detail.grid || metadata.hfa || metadata.iswc || detail.customId || metadata.customId || "";
    const musicalWorkTitle = title;
    const composerAuthor = formatDdexText(metadata.writers);
    const rightsControllerWorkId = detail.customId || metadata.customId;
    const usageDate = `${detail.date.slice(0, 4)}-${detail.date.slice(4, 6)}-${detail.date.slice(6, 8)}`;
    const commonFields = [
      detail.assetId,
      title,
      displayArtistName,
      "",
      isrc,
      dspWorkId,
      musicalWorkTitle,
      metadata.iswc,
      composerAuthor,
      "",
      detail.ownedViews.toFixed(2),
      usageDate,
      usageDate,
      "Music",
      rightsControllerWorkId,
      "1.0000",
    ];

    writers.ddexDsr.write(
      [
        "SR02",
        performingSummaryId,
        ...commonFields,
        "PerformingRight",
        "0.000000",
        detail.partnerRevenue.toFixed(6),
      ].join("\t") + "\n",
    );
    writers.ddexDsr.write(
      [
        "SR02",
        mechanicalSummaryId,
        ...commonFields,
        "MechanicalRight",
        "0.000000",
        detail.partnerRevenue.toFixed(6),
      ].join("\t") + "\n",
    );
  }

  writers.ddexDsr.write(["SRFO", String((detailRows.length * 2) + 2), "2"].join("\t") + "\n");
}

async function writeFinancialAdjustments(
  filePaths: string[],
  yearMonth: string,
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  writers: PublishingWriters,
): Promise<void> {
  for (const filePath of filePaths) {
    console.log(`[PublishingAdjustment] Parsing ${filePath}`);
    const rows = await parseCsvRows(filePath);
    for (const row of rows) {
      writeAdjustmentRow(row, yearMonth, classifier, publishingAssetIds, writers);
    }
  }
}

export async function runPublishingExtraction(cliArgs: string[] = process.argv.slice(2)): Promise<void> {
  const cliOptions = parseCliArgs(cliArgs);
  const config = resolveExtractionConfig(cliOptions);
  const withClassification = cliOptions.withClassification === true;
  const classifier = new AssetClassifier();
  const publishingUsageFallback = loadPublishingUsageCache();
  const publishingAssetIds = loadPublishingAssetIds();
  const directSources = resolvePublishingDirectSources(config.publishingDir, config.yearMonth);
  const directSourceResolution = getPublishingDirectSourceResolution(directSources);

  await classifier.initialize({
    neighboringDir: config.neighboringDir,
    publishingDir: config.publishingDir,
    cacheFile: config.cacheFile,
  });

  const writers = createPublishingWriters(config.outputDir);

  try {
    if (withClassification) {
      console.warn(
        "[Publishing] --with-classification is enabled, but automatic Embedded/Cover classification is still kept out of the default settlement pipeline.",
      );
    }

    // Direct publishing sources must come from the target-month API/export folder.
    // Client sample workbooks are intentionally excluded from the settlement pipeline.
    if (directSourceResolution.hasCompleteDirectSource) {
      const writtenDailyRows = await writeDelimitedCsvSource(
        directSources.dailyAdCsvPath!,
        PUBLISHING_DAILY_AD_HEADERS,
        writers.dailyAd,
        "dailyAd",
      );

      const writtenAdjustmentRows = await writeDelimitedCsvSource(
        directSources.adjustmentCsvPath!,
        PUBLISHING_ADJUSTMENT_HEADERS,
        writers.dailyAdAdjustment,
        "adjustment",
      );

      const writtenMonthlyRows = await writeDelimitedCsvSource(
        directSources.monthlyCsvPath!,
        PUBLISHING_MONTHLY_HEADERS,
        writers.monthlySubscription,
        "monthly",
      );

      const writtenDdexRows = await writeDdexCsvSource(directSources.ddexCsvPath!, writers.ddexDsr);

      console.log(
        `[Publishing] Direct-source export completed. daily=${writtenDailyRows} (${directSourceResolution.dailySourcePath}) adjustment=${writtenAdjustmentRows} (${directSourceResolution.adjustmentSourcePath}) monthly=${writtenMonthlyRows} (${directSourceResolution.monthlySourcePath}) ddex=${writtenDdexRows} (${directSourceResolution.ddexSourcePath})`,
      );
      return;
    }

    console.warn(
      `[Publishing] Complete target-month direct source not found in ${config.publishingDir}. Reconstructing from API reports only.`,
    );

    // TODO: Replace this raw fallback with a metadata-aware publishing reconstruction flow.
    // The missing piece is the classification layer that separates Embedded vs Cover and
    // determines whether a given claim type expands to Mechanical only or Mechanical+Performance.
    // That information likely comes from publishing direct exports or Content Manager asset
    // relationships, not from the raw revenue files below. See fetchAssetRelationships.ts
    // and the asset_relationship_cache.json output for the first automation step.
    const groups = listMonthlyReportGroups(config.reportDir, config.yearMonth);
    if (groups.length === 0) {
      console.warn(`[Publishing] No report files found for ${config.yearMonth} in ${config.reportDir}`);
      return;
    }

    const monthlyRevenueMap = new Map<string, MonthlySummaryEntry>();
    const usageFiles = groups.flatMap((group) => group.usageFiles);
    const financialFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "content_owner_asset_ad_revenue_raw_a1",
    );
    const adjustmentFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "content_owner_asset_ad_adjustment_revenue_raw_a1",
    );
    const redFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "music_content_owner_asset_red_revenue_raw_a1",
    );
    const audioTierFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "content_owner_claim_audio_tier_revenue_raw_a1",
    );
    const audioTierSummaryFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "content_owner_claim_audio_tier_revenue_summary_a1",
    );

    const hasAnyApiMonthlySource = Boolean(
      financialFiles.length > 0 ||
        adjustmentFiles.length > 0 ||
        redFiles.length > 0 ||
        audioTierFiles.length > 0 ||
        audioTierSummaryFiles.length > 0,
    );
    const hasAnyPartialDirectSource = Boolean(
      directSources.dailyAdCsvPath ||
        directSources.adjustmentCsvPath ||
        directSources.monthlyCsvPath ||
        directSources.ddexCsvPath,
    );
    if (!hasAnyApiMonthlySource && !hasAnyPartialDirectSource) {
      console.warn(
        `[Publishing] No API monthly source files found for ${config.yearMonth} in ${config.systemManagedDir}. Leaving publishing outputs header-only.`,
      );
      return;
    }

    const usageDerived = await buildPublishingUsageCacheFromReports(usageFiles);
    const usageByAsset = new Map<string, PublishingUsageCacheEntry>();
    for (const [usageKey, derived] of usageDerived.entries()) {
      const [assetId] = usageKey.split("|");
      const fallback = assetId ? publishingUsageFallback[assetId] : undefined;
      usageByAsset.set(usageKey, {
        totalRevenue: fallback?.totalRevenue ?? 0,
        adRevenue: fallback?.adRevenue ?? 0,
        subRevenue: fallback?.subRevenue ?? 0,
        totalViews: derived.totalViews || fallback?.totalViews || 0,
        watchPageViews: derived.watchPageViews || fallback?.watchPageViews || 0,
        embeddedViews: derived.embeddedViews || fallback?.embeddedViews || 0,
        channelPageViews: derived.channelPageViews || fallback?.channelPageViews || 0,
        liveViews: derived.liveViews || fallback?.liveViews || 0,
        onDemandViews: derived.onDemandViews || fallback?.onDemandViews || derived.totalViews || 0,
        adEnabledViews: derived.adEnabledViews || fallback?.adEnabledViews || derived.totalViews || 0,
        adsenseRevenue: fallback?.adsenseRevenue ?? 0,
        doubleclickServedYouTubeSoldRevenue: fallback?.doubleclickServedYouTubeSoldRevenue ?? 0,
        doubleclickServedPartnerSoldRevenue: fallback?.doubleclickServedPartnerSoldRevenue ?? 0,
        partnerServedPartnerSoldRevenue: fallback?.partnerServedPartnerSoldRevenue ?? 0,
        partnerAdsenseRevenue: fallback?.partnerAdsenseRevenue ?? 0,
        partnerDoubleclickServedYouTubeSoldRevenue: fallback?.partnerDoubleclickServedYouTubeSoldRevenue ?? 0,
        partnerDoubleclickServedPartnerSoldRevenue: fallback?.partnerDoubleclickServedPartnerSoldRevenue ?? 0,
        partnerPartnerServedPartnerSoldRevenue: fallback?.partnerPartnerServedPartnerSoldRevenue ?? 0,
      });
    }

    const financialMap = await parsePublishingFinancialFiles(financialFiles);
    const monthlyAdMap = buildMonthlyAdSummary(financialMap, usageByAsset, classifier, publishingAssetIds);
    const rawRedMap = await parseRedSummaryFiles(redFiles);
    const monthlyRedMap = new Map<string, RedSummaryEntry>();
    monthlyRevenueMap.clear();
    for (const [key, entry] of rawRedMap.entries()) {
      if (!isPublishingRecord(classifier, publishingAssetIds, entry.assetId)) {
        continue;
      }
      if (entry.adjustmentType !== "None") {
        continue;
      }
      monthlyRedMap.set(key, entry);
      monthlyRevenueMap.set(key, {
        assetId: entry.assetId,
        country: entry.country,
        month: config.yearMonth,
        revenue: entry.partnerRevenue,
        views: entry.ownedViews,
      });
    }
    console.log(
      `[Publishing] publishingAssetIds=${publishingAssetIds.size} financial=${financialMap.size} monthlyAd=${monthlyAdMap.size} rawRed=${rawRedMap.size} monthlyRed=${monthlyRedMap.size}`,
    );
    if (directSources.dailyAdCsvPath) {
      const writtenDailyRows = await writeDelimitedCsvSource(
        directSources.dailyAdCsvPath,
        PUBLISHING_DAILY_AD_HEADERS,
        writers.dailyAd,
        "dailyAd",
      );
      console.log(`[Publishing] Wrote daily ad output from direct csv ${directSources.dailyAdCsvPath}. rows=${writtenDailyRows}`);
    } else {
      writeMonthlyAdSummary(monthlyAdMap, classifier, publishingAssetIds, writers);
    }

    if (directSources.adjustmentCsvPath) {
      const writtenAdjustmentRows = await writeDelimitedCsvSource(
        directSources.adjustmentCsvPath,
        PUBLISHING_ADJUSTMENT_HEADERS,
        writers.dailyAdAdjustment,
        "adjustment",
      );
      console.log(`[Publishing] Wrote daily adjustment output from direct csv ${directSources.adjustmentCsvPath}. rows=${writtenAdjustmentRows}`);
    } else {
      await writeFinancialAdjustments(adjustmentFiles, config.yearMonth, classifier, publishingAssetIds, writers);
    }

    if (directSources.monthlyCsvPath) {
      const writtenMonthlyRows = await writeDelimitedCsvSource(
        directSources.monthlyCsvPath,
        PUBLISHING_MONTHLY_HEADERS,
        writers.monthlySubscription,
        "monthly",
      );
      console.log(`[Publishing] Wrote monthly subscription output from direct csv ${directSources.monthlyCsvPath}. rows=${writtenMonthlyRows}`);
    } else {
      writeMonthlySummary(monthlyRedMap, config.yearMonth, classifier, publishingAssetIds, writers);
    }

    if (directSources.ddexCsvPath) {
      const writtenDdexRows = await writeDdexCsvSource(directSources.ddexCsvPath, writers.ddexDsr);
      console.log(`[Publishing] Wrote DDEX output from direct csv ${directSources.ddexCsvPath}. rows=${writtenDdexRows}`);
    } else {
      const audioDetails = await parseAudioTierDetailFiles(audioTierFiles);
      const audioSummaryRow = await loadAudioTierSummaryRow(audioTierSummaryFiles, "KR");
      writeDdexDsr(audioDetails, audioSummaryRow, classifier, writers, config.yearMonth);
    }
    console.log(`[Publishing] Completed export for ${config.yearMonth} to ${config.outputDir}`);
  } finally {
    await closeWriters(Object.values(writers));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPublishingExtraction().catch((error) => {
    console.error("[Publishing] Extraction failed.", error);
    process.exitCode = 1;
  });
}
