// 대상 월 하나로 API 다운로드부터 8개 정산 파일과 GE 요약까지 실행하는 월별 실행기
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { createInterface } from "readline/promises";

const GENERAL_CONTENT_OWNER_ID = "2jFu0i9K0PE3MDrkU_UUfQ";
const PLA_CONTENT_OWNER_ID = "C9wllE5I6sRtJdunaUAdqQ";
const PLA_REPORT_TYPES = [
  "content_owner_asset_ad_revenue_raw_a1",
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
  "publisher_content_owner_music_asset_red_revenue_raw_a1",
  "publisher_content_owner_asset_red_adjustment_revenue_raw_a1",
  "content_owner_payments_summary_a1",
];
const PACKAGE_FILES = [
  "1_neighboring_daily_ad.csv",
  "1_publishing_daily_ad.csv",
  "2_neighboring_daily_ad_adj.csv",
  "2_publishing_daily_ad_adj.csv",
  "3_neighboring_monthly_sub.csv",
  "3_publishing_monthly_sub.csv",
  "4_neighboring_financial_detail.csv",
  "5_publishing_shorts_revenue_summary.csv",
];

function isValidYearMonth(value: string): boolean {
  if (!/^\d{6}$/.test(value)) {
    return false;
  }
  const month = Number(value.slice(4, 6));
  return month >= 1 && month <= 12;
}

async function resolveYearMonth(argv: string[]): Promise<string> {
  const option = argv.find((argument) => argument.startsWith("--yearMonth="));
  const positional = argv.find((argument) => /^\d{6}$/.test(argument));
  let yearMonth = option?.slice("--yearMonth=".length) ?? positional ?? "";

  if (!yearMonth) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      yearMonth = (await prompt.question("정산 대상 월을 YYYYMM 형식으로 입력하세요. ")).trim();
    } finally {
      prompt.close();
    }
  }

  if (!isValidYearMonth(yearMonth)) {
    throw new Error(`[MonthlySettlement] Invalid yearMonth: ${yearMonth}. Use YYYYMM.`);
  }
  return yearMonth;
}

async function runTsxStep(label: string, scriptPath: string, args: string[]): Promise<void> {
  console.log(`\n[MonthlySettlement] ${label}`);
  const tsxCliPath = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=8192", tsxCliPath, scriptPath, ...args],
    { cwd: process.cwd(), stdio: "inherit" },
  );

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`[MonthlySettlement] Step failed: ${label}. exitCode=${exitCode}`);
  }
}

function verifyOutputs(packageDir: string, geDir: string): void {
  const missingFiles = PACKAGE_FILES.filter((fileName) => !fs.existsSync(path.join(packageDir, fileName)));
  if (missingFiles.length > 0) {
    throw new Error(`[MonthlySettlement] Missing package files: ${missingFiles.join(", ")}`);
  }

  const publishingDsrPath = path.join(packageDir, "4_publishing_ddex_dsr.csv");
  if (fs.existsSync(publishingDsrPath)) {
    throw new Error(`[MonthlySettlement] Excluded Publishing 4 file exists: ${publishingDsrPath}`);
  }

  const gePath = path.join(geDir, "publishing_ge_summary.csv");
  if (!fs.existsSync(gePath)) {
    throw new Error(`[MonthlySettlement] Missing GE summary: ${gePath}`);
  }
}

async function run(): Promise<void> {
  const yearMonth = await resolveYearMonth(process.argv.slice(2));
  const packageDir = `reports_final_${yearMonth}_client_pla_8files`;
  const geDir = `reports_final_${yearMonth}_publishing_ge`;
  const commonMonthArg = `--yearMonth=${yearMonth}`;

  await runTsxStep("1/5 일별 raw data 다운로드", "src/getReports.ts", [commonMonthArg, "--reportDir=reports"]);
  await runTsxStep("2/5 일반 system-managed 다운로드", "src/downloadSystemManagedReports.ts", [
    commonMonthArg,
    `--contentOwnerId=${GENERAL_CONTENT_OWNER_ID}`,
    "--systemManagedDir=reports/system-managed",
  ]);
  await runTsxStep("3/5 PLA system-managed 다운로드", "src/downloadSystemManagedReports.ts", [
    commonMonthArg,
    `--contentOwnerId=${PLA_CONTENT_OWNER_ID}`,
    "--systemManagedDir=reports/system-managed-pla",
    `--reportTypeIds=${PLA_REPORT_TYPES.join(",")}`,
  ]);
  await runTsxStep("4/5 8개 정산 파일 생성 및 검증", "src/extractMonthlyClientPackage.ts", [
    commonMonthArg,
    "--reportDir=reports",
    "--systemManagedDir=reports/system-managed",
    "--publishingSystemManagedDir=reports/system-managed-pla",
    `--outputDir=${packageDir}`,
  ]);
  await runTsxStep("5/5 GE 총액 요약 생성", "src/extractPublishingGeSummary.ts", [
    commonMonthArg,
    "--publishingSystemManagedDir=reports/system-managed-pla",
    `--outputDir=${geDir}`,
  ]);

  verifyOutputs(packageDir, geDir);
  console.log(`\n[MonthlySettlement] Completed ${yearMonth}.`);
  console.log(`[MonthlySettlement] Package: ${packageDir}`);
  console.log(`[MonthlySettlement] GE summary: ${geDir}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
