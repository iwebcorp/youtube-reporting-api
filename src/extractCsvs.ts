import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { AssetClassifier } from "./assetClassifier.js";
import {
  parseAudioTierDetailFiles,
  parseCsvRows,
  parsePublishingFinancialFiles,
  parseRedSummaryFiles,
} from "./reporting/parsers.js";
import { createNeighboringWriters, closeWriters } from "./reporting/writers.js";
import {
  csvEscape,
  listMonthlySystemManagedFiles,
  parseCliArgs,
  resolveExtractionConfig,
} from "./reporting/utils.js";
import type { AudioTierDetailEntry, CsvRow, NeighboringWriters, RedSummaryEntry } from "./reporting/types.js";

type NeighboringDirectSourceKind = "dailyAd" | "adjustment" | "monthly" | "financial";

const NEIGHBORING_DAILY_AD_HEADERS = [
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
  "UPC",
  "GRid",
  "Artist",
  "Album",
  "Label",
  "Administer Publish Rights",
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

const NEIGHBORING_MONTHLY_HEADERS = [
  "Adjustment Type",
  "Month",
  "Country",
  "Asset ID",
  "Asset Title",
  "Asset Labels",
  "Asset Type",
  "Custom ID",
  "ISRC",
  "UPC",
  "GRID",
  "Artist",
  "Album",
  "Label",
  "Claim Type",
  "Content Type",
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

const NEIGHBORING_FINANCIAL_HEADERS = [
  "Adjustment Type",
  "Date",
  "Country",
  "Video ID",
  "Asset ID",
  "Asset Title",
  "Asset Labels",
  "Custom ID",
  "ISRC",
  "Upc",
  "Grid",
  "Artist",
  "Album",
  "Label",
  "Owned Views",
  "YouTube Revenue Split",
  "Partner Revenue Pro Rata",
  "Partner Revenue Per Play Min",
  "Partner Revenue",
] as const;

interface NeighboringDirectSources {
  dailyAdCsvPath: string | null;
  adjustmentCsvPath: string | null;
  monthlyCsvPath: string | null;
  financialCsvPath: string | null;
}

function fileNameMatchesYearMonth(fileName: string, yearMonth: string): boolean {
  const firstDateToken = fileName.match(/\d{4}-\d{2}|\d{8}|\d{6}/)?.[0];
  if (!firstDateToken) {
    return false;
  }

  return firstDateToken.replace(/-/g, "").startsWith(yearMonth);
}

function findDirectNeighboringCsv(
  neighboringDir: string,
  yearMonth: string,
  matcher: (fileName: string) => boolean,
): string | null {
  if (!fs.existsSync(neighboringDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(neighboringDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".csv"))
    .filter((fileName) => fileNameMatchesYearMonth(fileName, yearMonth))
    .filter(matcher)
    .sort();

  if (candidates.length === 0) {
    return null;
  }

  return path.join(neighboringDir, candidates[0]!);
}

function resolveNeighboringDirectSources(neighboringDir: string, yearMonth: string): NeighboringDirectSources {
  return {
    dailyAdCsvPath: findDirectNeighboringCsv(
      neighboringDir,
      yearMonth,
      (fileName) => fileName.includes("_asset_raw_") && !fileName.includes("_ADJ_"),
    ),
    adjustmentCsvPath: findDirectNeighboringCsv(
      neighboringDir,
      yearMonth,
      (fileName) => fileName.includes("_ADJ_asset_raw_"),
    ),
    monthlyCsvPath: findDirectNeighboringCsv(
      neighboringDir,
      yearMonth,
      (fileName) => fileName.includes("_red_label_rawdata_asset_"),
    ),
    financialCsvPath: findDirectNeighboringCsv(
      neighboringDir,
      yearMonth,
      (fileName) =>
        fileName.includes("_Financial_Detail_") ||
        /Audio_Tier.*Financial_Detail/i.test(fileName),
    ),
  };
}

function hasCompleteNeighboringDirectSource(directSources: NeighboringDirectSources): boolean {
  return Boolean(
    directSources.dailyAdCsvPath &&
      directSources.adjustmentCsvPath &&
      directSources.monthlyCsvPath &&
      directSources.financialCsvPath,
  );
}

function isPublishingRecord(
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  assetId: string,
  customId?: string,
): boolean {
  if (publishingAssetIds.has(assetId)) {
    return true;
  }

  const customIdCategory = classifier.classifyCustomId(customId ?? "");
  if (customIdCategory === "Publishing") {
    return true;
  }
  if (customIdCategory === "Neighboring") {
    return false;
  }

  const metadata = classifier.getMetadata(assetId);
  if (metadata.sourceCategory === "Publishing") {
    return true;
  }
  if (metadata.sourceCategory === "Neighboring") {
    return false;
  }

  if (metadata.iswc || metadata.hfa) {
    return true;
  }

  if (!metadata.isrc && metadata.writers) {
    return true;
  }

  return false;
}

function decodeTextFile(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString("utf-8");
  }

  const utf8Decoded = buffer.toString("utf-8");
  const cp949Decoded = iconv.decode(buffer, "cp949");
  const score = (text: string) => {
    const replacementCount = (text.match(/\uFFFD/g)?.length ?? 0);
    const questionCount = (text.match(/\?/g)?.length ?? 0);
    return -(replacementCount * 5) - questionCount;
  };
  return score(cp949Decoded) > score(utf8Decoded) ? cp949Decoded : utf8Decoded;
}

function createDirectCsvStream(filePath: string, stripAssetSummary: boolean): AsyncIterable<CsvRow> {
  const normalizedText = decodeTextFile(filePath).replace(/\r\n/g, "\n");
  const sourceText = stripAssetSummary && normalizedText.startsWith("Asset Summary\n")
    ? normalizedText.slice("Asset Summary\n".length)
    : normalizedText;

  return parse(sourceText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  }) as AsyncIterable<CsvRow>;
}

function cloneRowWithHeaders(row: CsvRow, orderedHeaders: readonly string[]): CsvRow {
  const cloned: CsvRow = {};
  for (const header of orderedHeaders) {
    cloned[header] = row[header] ?? "";
  }
  return cloned;
}

function expandNeighboringDirectSourceRows(kind: NeighboringDirectSourceKind, rows: CsvRow[]): CsvRow[] {
  switch (kind) {
    case "dailyAd":
    case "adjustment":
      // ?몄젒 1~2???섑뵆 CSV媛 ?대? 理쒖쥌 ??援ъ“? 湲덉븸???닿퀬 ?덉쑝誘濡?洹몃?濡?蹂듭젣?쒕떎.
      return rows.map((row) => cloneRowWithHeaders(row, NEIGHBORING_DAILY_AD_HEADERS));
    case "monthly":
      // ?몄젒 3? Asset Summary ?꾨━?쎌뒪留??쒓굅?섍퀬 ?섑뵆 ?됱쓣 洹몃?濡??좎??쒕떎.
      return rows.map((row) => cloneRowWithHeaders(row, NEIGHBORING_MONTHLY_HEADERS));
    case "financial":
      // ?몄젒 4??湲덉쑖 ?곸꽭 ?됱씠 理쒖쥌 ?뺤궛 ?⑥쐞?대?濡?異붽? ?꾧컻 ?놁씠 洹몃?濡??ъ슜?쒕떎.
      return rows.map((row) => cloneRowWithHeaders(row, NEIGHBORING_FINANCIAL_HEADERS));
    default:
      return rows;
  }
}

function writeOrderedRows(rows: CsvRow[], orderedHeaders: readonly string[], writer: NodeJS.WritableStream): number {
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

async function writeNeighboringDirectCsv(
  filePath: string,
  orderedHeaders: readonly string[],
  writer: NodeJS.WritableStream,
  kind: NeighboringDirectSourceKind,
): Promise<number> {
  let rowCount = 0;
  for await (const row of createDirectCsvStream(filePath, kind === "monthly")) {
    const expandedRows = expandNeighboringDirectSourceRows(kind, [row]);
    rowCount += writeOrderedRows(expandedRows, orderedHeaders, writer);
  }
  return rowCount;
}

function isNeighboringRecord(
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  assetId: string,
  customId?: string,
): boolean {
  void classifier;
  void publishingAssetIds;
  void assetId;
  void customId;
  return true;
}

function writeNeighboringAdRow(
  row: CsvRow,
  yearMonth: string,
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  writers: NeighboringWriters,
): void {
  const assetId = row["asset_id"]?.trim() ?? "";
  if (!assetId || !isNeighboringRecord(classifier, publishingAssetIds, assetId, row["custom_id"]?.trim() ?? "")) {
    return;
  }

  const day = row["day"]?.trim() || row["date"]?.trim() || "";
  const isAdjustment = (row["adjustment_type"]?.trim() ?? "None") !== "None";
  if (!isAdjustment && day && !day.startsWith(yearMonth)) {
    return;
  }

  const metadata = classifier.getMetadata(assetId);
  const target = isAdjustment ? writers.dailyAdAdjustment : writers.dailyAd;
  const title = row["asset_title"]?.trim() || metadata.title;
  const channelId = row["asset_channel_id"]?.trim() || row["channel_id"]?.trim() || metadata.channelId;
  const assetType = row["asset_type"]?.trim() || metadata.assetType;
  const customId = row["custom_id"]?.trim() || metadata.customId;
  const isrc = row["isrc"]?.trim() || metadata.isrc;
  const upc = row["upc"]?.trim() || metadata.upc;
  const artist = row["artist"]?.trim() || metadata.artist;
  const album = row["album"]?.trim() || metadata.album;
  const label = row["label"]?.trim() || metadata.label;
  const outputRow = [
    row["adjustment_type"]?.trim() || "None",
    day,
    row["country"]?.trim() || row["country_code"]?.trim() || "XX",
    assetId,
    csvEscape(title),
    "",
    channelId,
    assetType,
    customId,
    isrc,
    upc,
    "",
    csvEscape(artist),
    csvEscape(album),
    csvEscape(label),
    "no",
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
  target.write(`${outputRow.join(",")}\n`);
}

function writeNeighboringMonthlySummary(
  redMap: Map<string, RedSummaryEntry>,
  yearMonth: string,
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  writers: NeighboringWriters,
): void {
  for (const summary of redMap.values()) {
    if (!isNeighboringRecord(classifier, publishingAssetIds, summary.assetId, summary.sourceCustomId)) {
      continue;
    }

    const metadata = classifier.getMetadata(summary.assetId);
    const title = summary.sourceTitle || metadata.title;
    const assetType = summary.sourceAssetType || metadata.assetType;
    const customId = summary.sourceCustomId || metadata.customId;
    const isrc = summary.sourceIsrc || metadata.isrc;
    const upc = summary.sourceUpc || metadata.upc;
    const grid = summary.sourceGrid;
    const artist = summary.sourceArtist || metadata.artist;
    const album = summary.sourceAlbum || metadata.album;
    const label = summary.sourceLabel || metadata.label;
    const row = [
      summary.adjustmentType,
      yearMonth,
      summary.country,
      summary.assetId,
      csvEscape(title),
      "",
      assetType,
      customId,
      isrc,
      upc,
      grid,
      csvEscape(artist),
      csvEscape(album),
      csvEscape(label),
      summary.claimType,
      summary.contentType,
      summary.offer,
      String(summary.ownedViews),
      String(summary.monetizedViewsAudio),
      String(summary.monetizedViewsAudioVisual),
      String(summary.monetizedViews),
      summary.youtubeRevenueSplit.toFixed(12),
      summary.partnerRevenueProRataAudio.toFixed(12),
      summary.partnerRevenueProRataAudioVisual.toFixed(12),
      summary.partnerRevenueProRata.toFixed(12),
      summary.partnerRevenuePerSubMin.toFixed(12),
      summary.partnerRevenue.toFixed(12),
    ];
    writers.monthlySubscription.write(`${row.join(",")}\n`);
  }
}

function writeNeighboringFinancialDetail(
  details: AudioTierDetailEntry[],
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  writers: NeighboringWriters,
): void {
  for (const detail of details) {
    if (!isNeighboringRecord(classifier, publishingAssetIds, detail.assetId, detail.customId)) {
      continue;
    }

    const metadata = classifier.getMetadata(detail.assetId);
    const title = detail.title || metadata.title;
    const customId = detail.customId || metadata.customId;
    const isrc = detail.isrc || metadata.isrc;
    const upc = detail.upc || metadata.upc;
    const grid = detail.grid;
    const artist = detail.artist || metadata.artist;
    const album = detail.album || metadata.album;
    const label = detail.label || metadata.label;
    const row = [
      "None",
      detail.date,
      detail.country,
      detail.videoId,
      detail.assetId,
      csvEscape(title),
      "",
      customId,
      isrc,
      upc,
      grid,
      csvEscape(artist),
      csvEscape(album),
      csvEscape(label),
      String(detail.ownedViews),
      detail.youtubeRevenueSplit.toFixed(12),
      detail.partnerRevenueProRata.toFixed(12),
      detail.partnerRevenuePerPlayMin.toFixed(12),
      detail.partnerRevenue.toFixed(12),
    ];
    writers.financialDetail.write(`${row.join(",")}\n`);
  }
}

async function writeAdvertisingReports(
  financialFiles: string[],
  adjustmentFiles: string[],
  yearMonth: string,
  classifier: AssetClassifier,
  publishingAssetIds: Set<string>,
  writers: NeighboringWriters,
): Promise<void> {
  for (const filePath of financialFiles) {
    console.log(`[NeighboringAd] Parsing ${filePath}`);
    const rows = await parseCsvRows(filePath);
    for (const row of rows) {
      writeNeighboringAdRow(row, yearMonth, classifier, publishingAssetIds, writers);
    }
  }

  for (const filePath of adjustmentFiles) {
    console.log(`[NeighboringAdAdjustment] Parsing ${filePath}`);
    const rows = await parseCsvRows(filePath);
    for (const row of rows) {
      writeNeighboringAdRow(row, yearMonth, classifier, publishingAssetIds, writers);
    }
  }
}

export async function runNeighboringExtraction(cliArgs: string[] = process.argv.slice(2)): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const writers = createNeighboringWriters(config.outputDir);

  try {
    console.log(`[Neighboring] API-only export for ${config.yearMonth} from ${config.systemManagedDir}`);

    const classifier = new AssetClassifier();
    const publishingAssetIds = new Set<string>();
    await classifier.initialize({
      yearMonth: config.yearMonth,
      neighboringDir: config.neighboringDir,
      publishingDir: config.publishingDir,
    });

    const adFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "content_owner_asset_ad_revenue_raw_a1",
    );
    const adAdjustmentFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "content_owner_asset_ad_adjustment_revenue_raw_a1",
    );
    const redFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "music_content_owner_asset_red_revenue_raw_a1",
    );
    const redAdjustmentFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "music_content_owner_asset_red_adjustment_revenue_raw_a1",
    );
    const audioTierFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "content_owner_claim_audio_tier_revenue_raw_a1",
    );
    const paymentSummaryFiles = listMonthlySystemManagedFiles(
      config.systemManagedDir,
      config.yearMonth,
      "content_owner_payments_summary_a1",
    );
    const paymentSummaryFile = paymentSummaryFiles[paymentSummaryFiles.length - 1];
    if (!paymentSummaryFile) {
      throw new Error(`[Neighboring] Missing payment summary for ${config.yearMonth}`);
    }

    await writeAdvertisingReports(adFiles, adAdjustmentFiles, config.yearMonth, classifier, publishingAssetIds, writers);
    const redMap = await parseRedSummaryFiles([...redFiles, ...redAdjustmentFiles]);
    writeNeighboringMonthlySummary(redMap, config.yearMonth, classifier, publishingAssetIds, writers);
    const audioDetails = await parseAudioTierDetailFiles(audioTierFiles);
    writeNeighboringFinancialDetail(audioDetails, classifier, publishingAssetIds, writers);
    fs.copyFileSync(paymentSummaryFile, path.join(config.outputDir, "5_neighboring_payment_summary.csv"));
    console.log(`[Neighboring] Completed export for ${config.yearMonth} to ${config.outputDir}`);
  } finally {
    await closeWriters(Object.values(writers));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runNeighboringExtraction().catch((error) => {
    console.error("[Neighboring] Extraction failed.", error);
    process.exitCode = 1;
  });
}

