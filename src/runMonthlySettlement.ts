// 대상 월 하나로 API 다운로드부터 10개 전달 파일과 GE 요약까지 실행하는 월별 실행기
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { createInterface } from "readline/promises";
import {
  ASSET_METADATA_REPORT_TYPE,
  PACKAGE_FILES,
  PLA_REPORT_TYPES,
  SHORTS_VIDEO_FILE,
  checkManagedReadiness,
  checkRawReadiness,
  getMonthlyPaths,
  isValidYearMonth,
} from "./monthlyReadiness.js";

const GENERAL_CONTENT_OWNER_ID = "2jFu0i9K0PE3MDrkU_UUfQ";
const PLA_CONTENT_OWNER_ID = "C9wllE5I6sRtJdunaUAdqQ";
type SettlementStep = "raw" | "managed" | "extract";
const ALL_STEPS: SettlementStep[] = ["raw", "managed", "extract"];

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

function resolveSteps(argv: string[]): Set<SettlementStep> {
  const option = argv.find((argument) => argument.startsWith("--steps="));
  if (!option) return new Set(ALL_STEPS);

  const values = option
    .slice("--steps=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = values.filter((value) => !ALL_STEPS.includes(value as SettlementStep));
  if (values.length === 0 || invalid.length > 0) {
    throw new Error(`[MonthlySettlement] Invalid steps: ${invalid.join(", ") || "empty"}.`);
  }
  return new Set(values as SettlementStep[]);
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

function findLatestAssetMetadataFile(directoryPath: string, yearMonth: string): string {
  const prefix = `${yearMonth}_${ASSET_METADATA_REPORT_TYPE}_`;
  const files = fs
    .readdirSync(directoryPath)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith(".csv"))
    .sort((left, right) => right.localeCompare(left));
  const latestFile = files[0];
  if (!latestFile) {
    throw new Error(`[MonthlySettlement] Missing asset metadata snapshot for ${yearMonth}: ${directoryPath}`);
  }
  return path.join(directoryPath, latestFile);
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const yearMonth = await resolveYearMonth(argv);
  const steps = resolveSteps(argv);
  const paths = getMonthlyPaths(yearMonth);
  const { packageDir, geDir, assetMetadataDir, shortsRawDir } = paths;
  const commonMonthArg = `--yearMonth=${yearMonth}`;

  console.log(`[MonthlySettlement] Selected stages: ${[...steps].join(", ")}`);

  if (steps.has("raw")) {
    console.log("\n[MonthlySettlement] STAGE raw START");
    await runTsxStep("일별 raw data 다운로드", "src/getReports.ts", [commonMonthArg, `--reportDir=${paths.reportDir}`]);
    const raw = checkRawReadiness(yearMonth, paths);
    if (!raw.ready) {
      throw new Error(`[MonthlySettlement] Raw data incomplete: ${raw.present}/${raw.expected}.`);
    }
    console.log("[MonthlySettlement] STAGE raw COMPLETE");
  }

  if (steps.has("managed")) {
    console.log("\n[MonthlySettlement] STAGE managed START");
    await runTsxStep("일반 system-managed 다운로드", "src/downloadSystemManagedReports.ts", [
      commonMonthArg,
      `--contentOwnerId=${GENERAL_CONTENT_OWNER_ID}`,
      `--systemManagedDir=${paths.generalManagedDir}`,
    ]);
    await runTsxStep("자산 메타데이터 월말 스냅샷 다운로드", "src/downloadSystemManagedReports.ts", [
      commonMonthArg,
      `--contentOwnerId=${GENERAL_CONTENT_OWNER_ID}`,
      `--systemManagedDir=${assetMetadataDir}`,
      `--reportTypeIds=${ASSET_METADATA_REPORT_TYPE}`,
      "--latestOnly",
    ]);
    await runTsxStep("PLA system-managed 다운로드", "src/downloadSystemManagedReports.ts", [
      commonMonthArg,
      `--contentOwnerId=${PLA_CONTENT_OWNER_ID}`,
      `--systemManagedDir=${paths.plaManagedDir}`,
      `--reportTypeIds=${PLA_REPORT_TYPES.join(",")}`,
    ]);
    const managed = checkManagedReadiness(yearMonth, paths);
    if (!managed.ready) {
      throw new Error(`[MonthlySettlement] System-managed data incomplete: ${managed.present}/${managed.expected}. Reports may not be released yet.`);
    }
    console.log("[MonthlySettlement] STAGE managed COMPLETE");
  }

  if (!steps.has("extract")) {
    console.log(`\n[MonthlySettlement] Selected stages completed for ${yearMonth}.`);
    return;
  }

  const raw = checkRawReadiness(yearMonth, paths);
  const managed = checkManagedReadiness(yearMonth, paths);
  if (!raw.ready || !managed.ready) {
    throw new Error(
      `[MonthlySettlement] Extract requires ready raw and system-managed data. raw=${raw.present}/${raw.expected}, managed=${managed.present}/${managed.expected}.`,
    );
  }

  console.log("\n[MonthlySettlement] STAGE extract START");
  await runTsxStep("9개 정산 파일 생성 및 검증", "src/extractMonthlyClientPackage.ts", [
    commonMonthArg,
    `--reportDir=${paths.reportDir}`,
    `--systemManagedDir=${paths.generalManagedDir}`,
    `--publishingSystemManagedDir=${paths.plaManagedDir}`,
    `--outputDir=${packageDir}`,
  ]);
  await runTsxStep("Shorts Video Usage 생성", "src/extractShortsSongData.ts", [
    commonMonthArg,
    `--reportDir=${paths.reportDir}`,
    `--outputDir=${shortsRawDir}`,
  ]);
  const assetMetadataFile = findLatestAssetMetadataFile(assetMetadataDir, yearMonth);
  await runTsxStep("Shorts Video Usage 메타데이터 보강", "src/enrichShortsSongData.ts", [
    `--inputFile=${path.join(shortsRawDir, `shorts_video_usage_detail_${yearMonth}.csv`)}`,
    `--assetMetadataFile=${assetMetadataFile}`,
    `--outputFile=${path.join(packageDir, SHORTS_VIDEO_FILE)}`,
  ]);
  await runTsxStep("GE 총액 요약 생성", "src/extractPublishingGeSummary.ts", [
    commonMonthArg,
    `--publishingSystemManagedDir=${paths.plaManagedDir}`,
    `--outputDir=${geDir}`,
  ]);

  verifyOutputs(packageDir, geDir);
  console.log("[MonthlySettlement] STAGE extract COMPLETE");
  console.log(`\n[MonthlySettlement] Completed ${yearMonth}.`);
  console.log(`[MonthlySettlement] Package: ${packageDir}`);
  console.log(`[MonthlySettlement] GE summary: ${geDir}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
