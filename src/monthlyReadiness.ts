// 월별 정산 단계에 필요한 실제 파일 준비 상태를 검사하는 모듈
import * as fs from "fs";
import * as path from "path";
import { parse as parseCsv } from "csv-parse/sync";

export const GENERAL_REPORT_TYPES = [
  "content_owner_asset_ad_revenue_raw_a1",
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
  "music_content_owner_asset_red_revenue_raw_a1",
  "music_content_owner_asset_red_adjustment_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_summary_a1",
  "music_content_owner_shorts_revenue_summary_a1",
  "content_owner_payments_summary_a1",
] as const;

export const PLA_REPORT_TYPES = [
  "content_owner_asset_ad_revenue_raw_a1",
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
  "publisher_content_owner_music_asset_red_revenue_raw_a1",
  "publisher_content_owner_asset_red_adjustment_revenue_raw_a1",
  "content_owner_payments_summary_a1",
] as const;

export const ASSET_METADATA_REPORT_TYPE = "content_owner_asset_a3";
export const SHORTS_VIDEO_FILE = "6_shorts_video_usage_detail.csv";

export function contentIdCustomIdFileName(yearMonth: string): string {
  return `${yearMonth}_content_id_custom_ids.csv`;
}

export function customIdInputFileName(yearMonth: string): string {
  return `custom_id_input_required_${yearMonth}.csv`;
}

export function settlementSummaryFileName(yearMonth: string): string {
  return `정산금_요약_${yearMonth}.csv`;
}

export const SETTLEMENT_NEIGHBORING_FOLDER = "인접";
export const SETTLEMENT_PUBLISHING_FOLDER = "저작";
export const SETTLEMENT_PERFORMANCE_FOLDER = "실연권료";
// 저작 오디오서비스는 API로 제공되지 않아 계산 대상에서 뺀다(Publishing 4 제외와 같은 기준).
export const SETTLEMENT_FILES = [
  ...[
    "1_neighboring_daily_ad.csv",
    "2_neighboring_daily_ad_adj.csv",
    "3_neighboring_monthly_sub.csv",
    "4_neighboring_financial_detail.csv",
    "5_publishing_shorts_revenue_summary.csv",
    SHORTS_VIDEO_FILE,
  ].map((fileName) => path.join(SETTLEMENT_NEIGHBORING_FOLDER, fileName)),
  ...["1_publishing_daily_ad.csv", "2_publishing_daily_ad_adj.csv", "3_publishing_monthly_sub.csv"]
    .map((fileName) => path.join(SETTLEMENT_PUBLISHING_FOLDER, fileName)),
  ...["1_neighboring_daily_ad.csv", "3_neighboring_monthly_sub.csv"]
    .map((fileName) => path.join(SETTLEMENT_PERFORMANCE_FOLDER, fileName)),
];

const SETTLEMENT_FOLDERS = [SETTLEMENT_NEIGHBORING_FOLDER, SETTLEMENT_PUBLISHING_FOLDER, SETTLEMENT_PERFORMANCE_FOLDER];

export const CUSTOM_ID_ISSUE_BLANK = "공란";
export const CUSTOM_ID_ISSUE_NOTE = "참고";

export type CustomIdWarning = {
  filePath: string;
  blankRows: number;
  blankAssets: number;
  noteRows: number;
  noteAssets: number;
};
const OPTIONAL_MANAGED_REPORT_TYPES = new Set<string>([
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
  "music_content_owner_asset_red_adjustment_revenue_raw_a1",
  "publisher_content_owner_asset_red_adjustment_revenue_raw_a1",
]);
export const PACKAGE_FILES = [
  "1_neighboring_daily_ad.csv",
  "1_publishing_daily_ad.csv",
  "2_neighboring_daily_ad_adj.csv",
  "2_publishing_daily_ad_adj.csv",
  "3_neighboring_monthly_sub.csv",
  "3_publishing_monthly_sub.csv",
  "4_neighboring_financial_detail.csv",
  "5_neighboring_payment_summary.csv",
  "5_publishing_shorts_revenue_summary.csv",
  SHORTS_VIDEO_FILE,
] as const;

export type ReadinessResult = {
  ready: boolean;
  present: number;
  expected: number;
  missing: string[];
  partial: string[];
};

export type MonthlyPaths = ReturnType<typeof getMonthlyPaths>;

export function isValidYearMonth(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false;
  const month = Number(value.slice(4, 6));
  return month >= 1 && month <= 12;
}

export function getMonthlyPaths(yearMonth: string) {
  return {
    reportDir: "reports",
    generalManagedDir: path.join("reports", "system-managed"),
    plaManagedDir: path.join("reports", "system-managed-pla"),
    assetMetadataDir: path.join("reports", "system-managed-assets"),
    plaAssetMetadataDir: path.join("reports", "system-managed-assets-pla"),
    shortsRawDir: path.join("reports", `shorts-usage-${yearMonth}`),
    packageDir: `reports_final_${yearMonth}_client_pla_10files`,
    geDir: `reports_final_${yearMonth}_publishing_ge`,
    customIdDir: `reports_custom_id_${yearMonth}`,
    settlementDir: `reports_settlement_${yearMonth}`,
  };
}

function isNonEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function listFiles(directoryPath: string): string[] {
  try {
    return fs.readdirSync(directoryPath);
  } catch {
    return [];
  }
}

function findPartialFiles(directoryPath: string, prefix: string): string[] {
  return listFiles(directoryPath)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith(".partial"))
    .map((fileName) => path.join(directoryPath, fileName));
}

export function checkRawReadiness(yearMonth: string, paths = getMonthlyPaths(yearMonth)): ReadinessResult {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(4, 6));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const reportTypes = ["content_owner_asset_estimated_revenue_a1", "content_owner_asset_combined_a3"];
  const expectedFiles: string[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-${String(day).padStart(2, "0")}`;
    for (const reportType of reportTypes) {
      expectedFiles.push(path.join(paths.reportDir, `report_${date}_${reportType}.csv`));
    }
  }

  const missing = expectedFiles.filter((filePath) => !isNonEmptyFile(filePath));
  const partial = findPartialFiles(paths.reportDir, `report_${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-`);
  return {
    ready: missing.length === 0 && partial.length === 0,
    present: expectedFiles.length - missing.length,
    expected: expectedFiles.length,
    missing,
    partial,
  };
}

function findManagedReport(directoryPath: string, yearMonth: string, reportType: string): string | undefined {
  const prefix = `${yearMonth}_${reportType}_`;
  return listFiles(directoryPath)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith(".csv"))
    .sort((left, right) => right.localeCompare(left))
    .map((fileName) => path.join(directoryPath, fileName))
    .find(isNonEmptyFile);
}

export function checkManagedReadiness(
  yearMonth: string,
  paths = getMonthlyPaths(yearMonth),
): ReadinessResult {
  const requirements = [
    ...GENERAL_REPORT_TYPES.map((reportType) => ({ directory: paths.generalManagedDir, reportType })),
    ...PLA_REPORT_TYPES.map((reportType) => ({ directory: paths.plaManagedDir, reportType })),
    { directory: paths.assetMetadataDir, reportType: ASSET_METADATA_REPORT_TYPE },
    { directory: paths.plaAssetMetadataDir, reportType: ASSET_METADATA_REPORT_TYPE },
  ].filter(({ reportType }) => !OPTIONAL_MANAGED_REPORT_TYPES.has(reportType));
  const contentIdFiles = [paths.assetMetadataDir, paths.plaAssetMetadataDir]
    .map((directory) => path.join(directory, contentIdCustomIdFileName(yearMonth)));
  const missing = [
    ...requirements
      .filter(({ directory, reportType }) => !findManagedReport(directory, yearMonth, reportType))
      .map(({ directory, reportType }) => path.join(directory, `${yearMonth}_${reportType}_*.csv`)),
    ...contentIdFiles.filter((filePath) => !isNonEmptyFile(filePath)),
  ];
  const partial = requirements.flatMap(({ directory, reportType }) =>
    findPartialFiles(directory, `${yearMonth}_${reportType}_`),
  );
  const expected = requirements.length + contentIdFiles.length;

  return {
    ready: missing.length === 0 && partial.length === 0,
    present: expected - missing.length,
    expected,
    missing,
    partial,
  };
}

export function checkOutputReadiness(yearMonth: string, paths = getMonthlyPaths(yearMonth)): ReadinessResult {
  const expectedFiles = [
    ...PACKAGE_FILES.map((fileName) => path.join(paths.packageDir, fileName)),
    path.join(paths.geDir, "publishing_ge_summary.csv"),
    ...SETTLEMENT_FILES.map((fileName) => path.join(paths.settlementDir, fileName)),
    path.join(paths.settlementDir, settlementSummaryFileName(yearMonth)),
  ];
  const missing = expectedFiles.filter((filePath) => !isNonEmptyFile(filePath));
  const partial = [paths.packageDir, paths.geDir, paths.settlementDir, ...SETTLEMENT_FOLDERS.map((folder) => path.join(paths.settlementDir, folder))]
    .flatMap((directoryPath) => findPartialFiles(directoryPath, ""));
  return {
    ready: missing.length === 0 && partial.length === 0,
    present: expectedFiles.length - missing.length,
    expected: expectedFiles.length,
    missing,
    partial,
  };
}

// 추출 결과의 Custom ID 확인 목록(직접 입력할 공란, 참고 행) 건수를 요약한다.
export function getCustomIdWarning(yearMonth: string, paths = getMonthlyPaths(yearMonth)): CustomIdWarning | null {
  const filePath = path.join(paths.customIdDir, customIdInputFileName(yearMonth));
  if (!isNonEmptyFile(filePath)) return null;

  const records = parseCsv(fs.readFileSync(filePath, "utf-8"), { bom: true, columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const blanks = records.filter((record) => record["유형"] === CUSTOM_ID_ISSUE_BLANK);
  const notes = records.filter((record) => record["유형"] === CUSTOM_ID_ISSUE_NOTE);
  return {
    filePath: path.resolve(filePath),
    blankRows: blanks.length,
    blankAssets: new Set(blanks.map((record) => record["Asset ID"])).size,
    noteRows: notes.length,
    noteAssets: new Set(notes.map((record) => record["Asset ID"])).size,
  };
}

export function getMonthlyReadiness(yearMonth: string) {
  if (!isValidYearMonth(yearMonth)) {
    throw new Error(`Invalid yearMonth: ${yearMonth}. Use YYYYMM.`);
  }
  const paths = getMonthlyPaths(yearMonth);
  return {
    yearMonth,
    paths,
    raw: checkRawReadiness(yearMonth, paths),
    managed: checkManagedReadiness(yearMonth, paths),
    extract: checkOutputReadiness(yearMonth, paths),
    customIdWarning: getCustomIdWarning(yearMonth, paths),
  };
}
