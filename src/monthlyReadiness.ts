// 월별 정산 단계에 필요한 실제 파일 준비 상태를 검사하는 모듈
import * as fs from "fs";
import * as path from "path";

export const GENERAL_REPORT_TYPES = [
  "content_owner_asset_ad_revenue_raw_a1",
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
  "music_content_owner_asset_red_revenue_raw_a1",
  "music_content_owner_asset_red_adjustment_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_summary_a1",
  "music_content_owner_shorts_revenue_summary_a1",
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
export const PACKAGE_FILES = [
  "1_neighboring_daily_ad.csv",
  "1_publishing_daily_ad.csv",
  "2_neighboring_daily_ad_adj.csv",
  "2_publishing_daily_ad_adj.csv",
  "3_neighboring_monthly_sub.csv",
  "3_publishing_monthly_sub.csv",
  "4_neighboring_financial_detail.csv",
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
    shortsRawDir: path.join("reports", `shorts-usage-${yearMonth}`),
    packageDir: `reports_final_${yearMonth}_client_pla_9files`,
    geDir: `reports_final_${yearMonth}_publishing_ge`,
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
  ];
  const missing = requirements
    .filter(({ directory, reportType }) => !findManagedReport(directory, yearMonth, reportType))
    .map(({ directory, reportType }) => path.join(directory, `${yearMonth}_${reportType}_*.csv`));
  const partial = requirements.flatMap(({ directory, reportType }) =>
    findPartialFiles(directory, `${yearMonth}_${reportType}_`),
  );

  return {
    ready: missing.length === 0 && partial.length === 0,
    present: requirements.length - missing.length,
    expected: requirements.length,
    missing,
    partial,
  };
}

export function checkOutputReadiness(yearMonth: string, paths = getMonthlyPaths(yearMonth)): ReadinessResult {
  const expectedFiles = [
    ...PACKAGE_FILES.map((fileName) => path.join(paths.packageDir, fileName)),
    path.join(paths.geDir, "publishing_ge_summary.csv"),
  ];
  const missing = expectedFiles.filter((filePath) => !isNonEmptyFile(filePath));
  const partial = [
    ...findPartialFiles(paths.packageDir, ""),
    ...findPartialFiles(paths.geDir, ""),
  ];
  return {
    ready: missing.length === 0 && partial.length === 0,
    present: expectedFiles.length - missing.length,
    expected: expectedFiles.length,
    missing,
    partial,
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
  };
}
