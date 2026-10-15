// 5단계: Custom ID를 채운 정산 파일에 광수미디어 산식(docs/팡수.md)을 적용해 인접·저작·실연권료 정산금을 USD와 원으로 계산한다.
import * as fs from "fs";
import * as path from "path";
import {
  SETTLEMENT_NEIGHBORING_FOLDER,
  SETTLEMENT_PERFORMANCE_FOLDER,
  SETTLEMENT_PUBLISHING_FOLDER,
  SHORTS_VIDEO_FILE,
  getMonthlyPaths,
  isValidYearMonth,
  settlementSummaryFileName,
} from "./monthlyReadiness.js";
import { ZERO_ROW_COLUMNS, isZeroAmount } from "./removeZeroRows.js";
import { CsvFileWriter, readCsvRecords } from "./reporting/csvFile.js";
import {
  ZERO,
  add,
  decimal,
  divide,
  equals,
  formatDecimal,
  isZero,
  multiply,
  parseDecimal,
  subtract,
  type Decimal,
} from "./reporting/decimal.js";
import { ensureDirectory } from "./reporting/utils.js";

const HEADER_SEARCH_ROWS = 3;
const WITHHOLDING_COUNTRY = "US";
// 미국 원천세 10%를 뺀 비율
const AFTER_WITHHOLDING_RATE = decimal("0.9");
const PERFORMANCE_RATE = decimal("0.1147");
const PERFORMANCE_ASSET_TYPES = new Set(["art track", "sound recording"]);

const COUNTRY = "Country";
const ASSET_TYPE = "Asset Type";
const PARTNER_REVENUE = "Partner Revenue";
const SHORTS_REVENUE = "Shorts Flat Fee Revenue USD";
const ENGAGED_VIEWS = "Engaged Views";

// 원천세 공제 후 금액과 최종 금액은 USD와 원(환율 적용)을 나란히 붙인다.
const NEIGHBORING_COLUMNS = ["원천세 공제 후 Partner Revenue (USD)", "원천세 공제 후 Partner Revenue (원)", "인접 정산금 (USD)", "인접 정산금 (원)"];
const PERFORMANCE_COLUMNS = ["원천세 공제 후 Partner Revenue (USD)", "원천세 공제 후 Partner Revenue (원)", "실연권료 (USD)", "실연권료 (원)"];
const PUBLISHING_COLUMN = "저작 정산금 (원)";
const SHORTS_REVENUE_COLUMNS = ["원천세 공제 후 Shorts 수익 (USD)", "원천세 공제 후 Shorts 수익 (원)"];
const SHORTS_COLUMNS = ["원천세 공제 후 Shorts 수익 합계 (USD)", "Engaged Views 합계", "Engaged Views 점유율", "Shorts 인접권료 (USD)", "Shorts 인접권료 (원)"];

// 금액 합계는 모두 USD로 모으고, 요약에는 모든 금액을 USD와 환율을 곱한 원으로 함께 쓴다.
interface SummaryRow {
  section: string;
  fileName: string;
  rows: number;
  source: Decimal;
  afterWithholding: Decimal | null;
  result: Decimal;
  note: string;
}

type CellReader = (column: string) => string;

function getOption(argv: string[], name: string): string {
  const prefix = `--${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function readAmount(cell: CellReader, column: string, location: string): Decimal {
  const value = parseDecimal(cell(column));
  if (!value) {
    throw new Error(`[Settlement] ${location} '${column}' 값이 숫자가 아닙니다: "${cell(column)}"`);
  }
  return value;
}

function afterWithholding(country: string, revenue: Decimal): Decimal {
  return country.trim().toUpperCase() === WITHHOLDING_COUNTRY ? multiply(revenue, AFTER_WITHHOLDING_RATE) : revenue;
}

function isPerformanceAsset(cell: CellReader): boolean {
  return PERFORMANCE_ASSET_TYPES.has(cell(ASSET_TYPE).trim().toLowerCase());
}

// 헤더 이름으로 열을 찾아 행마다 계산 열을 덧붙인다. 헤더 위의 "Asset Summary" 같은 줄은 그대로 옮긴다.
// 3단계에서 지웠어야 할 금액 0인 행이 남아 있으면 여기서도 뺀다.
async function transformCsv(options: {
  sourcePath: string;
  outputPath: string;
  requiredColumns: string[];
  addedColumns: string[];
  // 결과 파일에서 뺄 행은 null을 돌려준다.
  compute: (cell: CellReader, location: string) => string[] | null;
}): Promise<number> {
  const fileName = path.basename(options.sourcePath);
  const zeroColumn = ZERO_ROW_COLUMNS[fileName];
  if (!fs.existsSync(options.sourcePath)) {
    throw new Error(`[Settlement] 정산 파일이 없습니다: ${options.sourcePath}`);
  }

  ensureDirectory(path.dirname(options.outputPath));
  const writer = new CsvFileWriter(options.outputPath);
  let columns: Map<string, number> | undefined;
  let recordIndex = 0;
  let rowCount = 0;
  for await (const { record, line } of readCsvRecords(options.sourcePath)) {
    recordIndex += 1;
    if (!columns) {
      const headers = record.map((value) => value.trim());
      if (options.requiredColumns.every((column) => headers.includes(column))) {
        columns = new Map();
        headers.forEach((header, index) => { if (!columns!.has(header)) columns!.set(header, index); });
        await writer.write([...record, ...options.addedColumns]);
      } else if (recordIndex >= HEADER_SEARCH_ROWS) {
        throw new Error(`[Settlement] ${fileName}에서 ${options.requiredColumns.join(", ")} 열을 찾지 못했습니다.`);
      } else {
        await writer.write(record);
      }
      continue;
    }

    const headerColumns = columns;
    const cell: CellReader = (column) => record[headerColumns.get(column) ?? -1] ?? "";
    if (zeroColumn && isZeroAmount(cell(zeroColumn))) continue;
    const added = options.compute(cell, `${fileName} ${line}행`);
    if (!added) continue;
    await writer.write([...record, ...added]);
    rowCount += 1;
  }
  await writer.close();
  if (!columns) throw new Error(`[Settlement] ${fileName}에 데이터가 없습니다.`);
  return rowCount;
}

// 인접 광고·조정·레드·오디오서비스: 미국 행만 원천세 10%를 빼고, 1·3번은 Art Track·Sound Recording 행에서 실연권료 11.47%를 뺀다.
async function calculateNeighboring(
  packageDir: string,
  outputDir: string,
  fileName: string,
  withPerformance: boolean,
  exchangeRate: Decimal,
): Promise<{ summary: SummaryRow; performance: SummaryRow | null }> {
  const summary: SummaryRow = {
    section: "인접",
    fileName,
    rows: 0,
    source: ZERO,
    afterWithholding: ZERO,
    result: ZERO,
    note: withPerformance ? "US 원천세 10% 공제, Art Track·Sound Recording 실연권료 11.47% 공제" : "US 원천세 10% 공제",
  };
  summary.rows = await transformCsv({
    sourcePath: path.join(packageDir, fileName),
    outputPath: path.join(outputDir, SETTLEMENT_NEIGHBORING_FOLDER, fileName),
    requiredColumns: withPerformance ? [COUNTRY, ASSET_TYPE, PARTNER_REVENUE] : [COUNTRY, PARTNER_REVENUE],
    addedColumns: NEIGHBORING_COLUMNS,
    compute: (cell, location) => {
      const revenue = readAmount(cell, PARTNER_REVENUE, location);
      const net = afterWithholding(cell(COUNTRY), revenue);
      const performance = withPerformance && isPerformanceAsset(cell) ? multiply(net, PERFORMANCE_RATE) : ZERO;
      const neighboring = subtract(net, performance);
      summary.source = add(summary.source, revenue);
      summary.afterWithholding = add(summary.afterWithholding!, net);
      summary.result = add(summary.result, neighboring);
      return withWon([net, neighboring], exchangeRate);
    },
  });
  if (!withPerformance) return { summary, performance: null };

  // 실연권료는 별도 내역이 없어 같은 파일의 Art Track·Sound Recording 행만 모아 만든다.
  const performance: SummaryRow = {
    section: "실연권료",
    fileName,
    rows: 0,
    source: ZERO,
    afterWithholding: ZERO,
    result: ZERO,
    note: "Art Track·Sound Recording 행, US 원천세 10% 공제 후 11.47%",
  };
  performance.rows = await transformCsv({
    sourcePath: path.join(packageDir, fileName),
    outputPath: path.join(outputDir, SETTLEMENT_PERFORMANCE_FOLDER, fileName),
    requiredColumns: [COUNTRY, ASSET_TYPE, PARTNER_REVENUE],
    addedColumns: PERFORMANCE_COLUMNS,
    compute: (cell, location) => {
      if (!isPerformanceAsset(cell)) return null;
      const revenue = readAmount(cell, PARTNER_REVENUE, location);
      const net = afterWithholding(cell(COUNTRY), revenue);
      const amount = multiply(net, PERFORMANCE_RATE);
      performance.source = add(performance.source, revenue);
      performance.afterWithholding = add(performance.afterWithholding!, net);
      performance.result = add(performance.result, amount);
      return withWon([net, amount], exchangeRate);
    },
  });
  return { summary, performance };
}

// 각 USD 금액 뒤에 환율을 곱한 원 금액을 붙인다.
function withWon(amounts: Decimal[], exchangeRate: Decimal): string[] {
  return amounts.flatMap((amount) => [formatDecimal(amount), formatDecimal(multiply(amount, exchangeRate))]);
}

// Shorts: 5번 파일의 원천세 공제 후 수익(US만 10% 공제) 합계를, 5번 파일에 있는 국가의 6번 파일 행 전체 Engaged Views 점유율대로 나눈다.
// 점유율은 국가별이 아니라 대상 행 전체 합계 기준이다(6_shorts_video_usage_detail-점유율산식예시.md).
async function calculateShorts(packageDir: string, outputDir: string, exchangeRate: Decimal): Promise<SummaryRow[]> {
  const revenueFileName = "5_publishing_shorts_revenue_summary.csv";
  const countries = new Set<string>();
  const revenueSummary: SummaryRow = {
    section: "인접",
    fileName: revenueFileName,
    rows: 0,
    source: ZERO,
    afterWithholding: ZERO,
    result: ZERO,
    note: "US 원천세 10% 공제",
  };
  revenueSummary.rows = await transformCsv({
    sourcePath: path.join(packageDir, revenueFileName),
    outputPath: path.join(outputDir, SETTLEMENT_NEIGHBORING_FOLDER, revenueFileName),
    requiredColumns: [COUNTRY, SHORTS_REVENUE],
    addedColumns: SHORTS_REVENUE_COLUMNS,
    compute: (cell, location) => {
      const country = cell(COUNTRY).trim();
      const revenue = readAmount(cell, SHORTS_REVENUE, location);
      const net = afterWithholding(country, revenue);
      countries.add(country);
      revenueSummary.source = add(revenueSummary.source, revenue);
      revenueSummary.afterWithholding = add(revenueSummary.afterWithholding!, net);
      revenueSummary.result = add(revenueSummary.result, net);
      return withWon([net], exchangeRate);
    },
  });
  const totalRevenue = revenueSummary.result;

  // 6번 파일의 Category는 분배와 관계없이 대상 국가의 모든 행을 대상으로 점유율을 낸다.
  const usagePath = path.join(packageDir, SHORTS_VIDEO_FILE);
  let totalViews = ZERO;
  let headerColumns: { country: number; engagedViews: number } | undefined;
  for await (const { record, line } of readCsvRecords(usagePath)) {
    if (!headerColumns) {
      const headers = record.map((value) => value.trim());
      if (headers.includes(COUNTRY) && headers.includes(ENGAGED_VIEWS)) {
        headerColumns = { country: headers.indexOf(COUNTRY), engagedViews: headers.indexOf(ENGAGED_VIEWS) };
      }
      continue;
    }
    if (!countries.has((record[headerColumns.country] ?? "").trim())) continue;
    const views = record[headerColumns.engagedViews] ?? "";
    totalViews = add(totalViews, readAmount(() => views, ENGAGED_VIEWS, `${SHORTS_VIDEO_FILE} ${line}행`));
  }
  if (isZero(totalViews) && !isZero(totalRevenue)) {
    throw new Error(`[Settlement] Shorts 수익 ${formatDecimal(totalRevenue)} USD를 나눌 ${SHORTS_VIDEO_FILE} Engaged Views가 없습니다.`);
  }

  const usageSummary: SummaryRow = {
    section: "인접",
    fileName: SHORTS_VIDEO_FILE,
    rows: 0,
    source: totalRevenue,
    afterWithholding: totalRevenue,
    result: ZERO,
    note: `5번 파일 원천세 공제 후 합계를 Engaged Views 점유율(전체 ${formatDecimal(totalViews)})로 분배`,
  };
  usageSummary.rows = await transformCsv({
    sourcePath: usagePath,
    outputPath: path.join(outputDir, SETTLEMENT_NEIGHBORING_FOLDER, SHORTS_VIDEO_FILE),
    requiredColumns: [COUNTRY, ENGAGED_VIEWS],
    addedColumns: SHORTS_COLUMNS,
    compute: (cell, location) => {
      if (!countries.has(cell(COUNTRY).trim())) return null;
      const engagedViews = readAmount(cell, ENGAGED_VIEWS, location);
      const share = divide(engagedViews, totalViews);
      // 잘린 점유율을 곱하면 오차가 커지므로 수익 × Engaged Views를 먼저 계산하고 나눈다.
      const amount = divide(multiply(totalRevenue, engagedViews), totalViews);
      usageSummary.result = add(usageSummary.result, amount);
      return [formatDecimal(totalRevenue), formatDecimal(totalViews), formatDecimal(share), ...withWon([amount], exchangeRate)];
    },
  });
  return [revenueSummary, usageSummary];
}

// 저작 광고·조정·레드: Partner Revenue × 환율
async function calculatePublishing(
  packageDir: string,
  outputDir: string,
  fileName: string,
  exchangeRate: Decimal,
): Promise<SummaryRow> {
  const summary: SummaryRow = {
    section: "저작",
    fileName,
    rows: 0,
    source: ZERO,
    afterWithholding: null,
    result: ZERO,
    note: "Partner Revenue × 환율",
  };
  summary.rows = await transformCsv({
    sourcePath: path.join(packageDir, fileName),
    outputPath: path.join(outputDir, SETTLEMENT_PUBLISHING_FOLDER, fileName),
    requiredColumns: [PARTNER_REVENUE],
    addedColumns: [PUBLISHING_COLUMN],
    compute: (cell, location) => {
      const revenue = readAmount(cell, PARTNER_REVENUE, location);
      summary.source = add(summary.source, revenue);
      summary.result = add(summary.result, revenue);
      return [formatDecimal(multiply(revenue, exchangeRate))];
    },
  });
  return summary;
}

async function writeSummary(filePath: string, exchangeRate: Decimal, rows: SummaryRow[]): Promise<void> {
  const won = (value: Decimal) => formatDecimal(multiply(value, exchangeRate));
  const writer = new CsvFileWriter(filePath);
  await writer.write(["환율 (원/USD)", formatDecimal(exchangeRate)]);
  await writer.write([
    "구분",
    "파일",
    "계산 행 수",
    "원본 금액 합계 (USD)",
    "원본 금액 합계 (원)",
    "원천세 공제 후 합계 (USD)",
    "원천세 공제 후 합계 (원)",
    "결과 합계 (USD)",
    "결과 합계 (원)",
    "산식",
  ]);
  for (const row of rows) {
    await writer.write([
      row.section,
      row.fileName,
      String(row.rows),
      formatDecimal(row.source),
      won(row.source),
      row.afterWithholding ? formatDecimal(row.afterWithholding) : "",
      row.afterWithholding ? won(row.afterWithholding) : "",
      formatDecimal(row.result),
      won(row.result),
      row.note,
    ]);
  }
  await writer.close();
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const yearMonth = getOption(argv, "yearMonth");
  if (!isValidYearMonth(yearMonth)) {
    throw new Error(`[Settlement] Invalid yearMonth: ${yearMonth}. Use YYYYMM.`);
  }
  const exchangeRate = parseDecimal(getOption(argv, "exchangeRate"));
  if (!exchangeRate || exchangeRate.units <= 0n) {
    throw new Error("[Settlement] 환율(원/USD)을 0보다 큰 숫자로 입력해 주세요. 예: --exchangeRate=1385.2");
  }
  const paths = getMonthlyPaths(yearMonth);
  const packageDir = getOption(argv, "packageDir") || paths.packageDir;
  const outputDir = getOption(argv, "outputDir") || paths.settlementDir;
  console.log(`[Settlement] ${yearMonth} 환율=${formatDecimal(exchangeRate)} 원본=${path.resolve(packageDir)}`);

  const summaries: SummaryRow[] = [];
  const performances: SummaryRow[] = [];
  for (const [fileName, withPerformance] of [
    ["1_neighboring_daily_ad.csv", true],
    ["2_neighboring_daily_ad_adj.csv", false],
    ["3_neighboring_monthly_sub.csv", true],
    ["4_neighboring_financial_detail.csv", false],
  ] as const) {
    const { summary, performance } = await calculateNeighboring(packageDir, outputDir, fileName, withPerformance, exchangeRate);
    summaries.push(summary);
    if (performance) performances.push(performance);
    console.log(`[Settlement] 인접 ${fileName} rows=${summary.rows} 정산금=${formatDecimal(summary.result)} USD`);
  }
  summaries.push(...await calculateShorts(packageDir, outputDir, exchangeRate));
  console.log(`[Settlement] 인접 Shorts 정산금=${formatDecimal(summaries[summaries.length - 1]!.result)} USD`);

  for (const fileName of ["1_publishing_daily_ad.csv", "2_publishing_daily_ad_adj.csv", "3_publishing_monthly_sub.csv"]) {
    const summary = await calculatePublishing(packageDir, outputDir, fileName, exchangeRate);
    summaries.push(summary);
    console.log(`[Settlement] 저작 ${fileName} rows=${summary.rows} 정산금=${formatDecimal(multiply(summary.result, exchangeRate))} 원`);
  }
  for (const performance of performances) {
    console.log(`[Settlement] 실연권료 ${performance.fileName} rows=${performance.rows} 매출=${formatDecimal(performance.result)} USD`);
  }
  summaries.push(...performances);

  // 1·3번 인접 정산금과 실연권료를 더하면 원천세 공제 후 금액과 같아야 한다.
  for (const performance of performances) {
    const neighboring = summaries.find((row) => row.section === "인접" && row.fileName === performance.fileName)!;
    if (!equals(subtract(neighboring.afterWithholding!, neighboring.result), performance.result)) {
      throw new Error(`[Settlement] ${performance.fileName} 인접 정산금과 실연권료 합계가 원천세 공제 후 금액과 맞지 않습니다.`);
    }
  }

  const summaryPath = path.join(outputDir, settlementSummaryFileName(yearMonth));
  await writeSummary(summaryPath, exchangeRate, summaries);
  console.log(`[Settlement] 정산금 계산 완료: ${path.resolve(outputDir)}`);
  console.log(`[Settlement] 요약: ${path.resolve(summaryPath)}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
