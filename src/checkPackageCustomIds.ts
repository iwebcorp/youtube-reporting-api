// 전달용 정산 파일에서 Custom ID가 빈 행과 CMS에 Custom ID가 여러 개인 곡의 행을 찾아 위치를 CSV로 남긴다.
import * as fs from "fs";
import * as path from "path";
import { AssetClassifier } from "./assetClassifier.js";
import {
  CUSTOM_ID_ISSUE_BLANK,
  CUSTOM_ID_ISSUE_NOTE,
  PACKAGE_FILES,
  customIdInputFileName,
  getMonthlyPaths,
} from "./monthlyReadiness.js";
import { readCsvRecords } from "./reporting/csvFile.js";
import { clean, csvEscape, ensureDirectory, parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

const HEADER_SEARCH_ROWS = 2;
const CUSTOM_ID_HEADER = "Custom ID";
const BLANK_GUIDE = "Custom ID가 없거나 숫자로만 구성된 값이 아니어서 공란으로 처리되었습니다. 이 행의 Custom ID 칸에 직접 입력해 주세요.";
const NOTE_GUIDE = "YouTube CMS에 이 곡의 Custom ID가 여러 개 등록되어 있습니다. 정산 파일에는 YouTube 정산 보고서가 준 현재 값을 사용했으므로 입력은 필요 없습니다. CMS 정리가 필요한지 확인해 주세요.";

interface CustomIdIssueRow {
  kind: typeof CUSTOM_ID_ISSUE_BLANK | typeof CUSTOM_ID_ISSUE_NOTE;
  fileName: string;
  lineNumber: number;
  columnLetter: string;
  assetId: string;
  assetTitle: string;
  country: string;
  currentValue: string;
  registeredValues: string[];
}

// 0부터 시작하는 열 번호를 Excel 열 이름(A, B, ..., AA)으로 바꾼다.
function toColumnLetter(index: number): string {
  let letter = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letter = String.fromCharCode(65 + ((value - 1) % 26)) + letter;
  }
  return letter;
}

async function findCustomIdIssueRows(filePath: string, classifier: AssetClassifier): Promise<CustomIdIssueRow[]> {
  const fileName = path.basename(filePath);
  const issues: CustomIdIssueRow[] = [];
  let recordIndex = 0;
  let columns: { customId: number; assetId: number; assetTitle: number; country: number } | undefined;
  // 사용자가 Excel로 Custom ID를 입력해 UTF-8로 저장했을 수도 있어 인코딩을 판별해 읽는다.
  for await (const { record: values, line } of readCsvRecords(filePath)) {
    recordIndex += 1;
    if (!columns) {
      const customId = values.indexOf(CUSTOM_ID_HEADER);
      if (customId >= 0) {
        columns = {
          customId,
          assetId: values.indexOf("Asset ID"),
          assetTitle: values.indexOf("Asset Title"),
          country: values.indexOf("Country"),
        };
      } else if (recordIndex >= HEADER_SEARCH_ROWS) {
        return [];
      }
      continue;
    }

    const currentValue = clean(values[columns.customId]);
    const assetId = clean(values[columns.assetId]);
    const registeredValues = classifier.getCompositionShareCustomIds(assetId);
    if (currentValue && registeredValues.length < 2) continue;
    issues.push({
      kind: currentValue ? CUSTOM_ID_ISSUE_NOTE : CUSTOM_ID_ISSUE_BLANK,
      fileName,
      lineNumber: line,
      columnLetter: toColumnLetter(columns.customId),
      assetId,
      assetTitle: clean(values[columns.assetTitle]),
      country: clean(values[columns.country]),
      currentValue,
      registeredValues,
    });
  }
  return issues;
}

async function run(): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(process.argv.slice(2)));
  const outputDir = path.resolve(getMonthlyPaths(config.yearMonth).customIdDir);
  const outputPath = path.join(outputDir, customIdInputFileName(config.yearMonth));

  const classifier = new AssetClassifier();
  await classifier.initialize({
    yearMonth: config.yearMonth,
    neighboringDir: config.neighboringDir,
    publishingDir: config.publishingDir,
    includeContentIdCustomIds: false,
  });

  const issues: CustomIdIssueRow[] = [];
  for (const fileName of PACKAGE_FILES) {
    const filePath = path.join(config.outputDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`[CustomIdCheck] Missing package file: ${filePath}`);
    }
    issues.push(...await findCustomIdIssueRows(filePath, classifier));
  }

  if (issues.length === 0) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    console.log(`[CustomIdCheck] 모든 정산 파일 행에 Custom ID가 채워져 있습니다. (${config.yearMonth})`);
    return;
  }

  // 직접 입력이 필요한 공란을 먼저, 참고 행을 뒤에 둔다.
  issues.sort((left, right) => Number(left.kind === CUSTOM_ID_ISSUE_NOTE) - Number(right.kind === CUSTOM_ID_ISSUE_NOTE));
  const lines = [
    "유형,파일,행 번호,열,열 이름,Asset ID,Asset Title,Country,현재 값,CMS 등록 Custom ID,안내",
    ...issues.map((row) =>
      [
        row.kind,
        row.fileName,
        String(row.lineNumber),
        row.columnLetter,
        CUSTOM_ID_HEADER,
        row.assetId,
        csvEscape(row.assetTitle),
        row.country,
        csvEscape(row.currentValue),
        csvEscape(row.registeredValues.join(" | ")),
        csvEscape(row.kind === CUSTOM_ID_ISSUE_BLANK ? BLANK_GUIDE : NOTE_GUIDE),
      ].join(","),
    ),
  ];
  ensureDirectory(outputDir);
  // Excel이 한글과 특수문자를 깨지 않고 열도록 UTF-8 BOM으로 저장한다.
  fs.writeFileSync(outputPath, `﻿${lines.join("\n")}\n`, "utf-8");

  const blanks = issues.filter((row) => row.kind === CUSTOM_ID_ISSUE_BLANK);
  const notes = issues.filter((row) => row.kind === CUSTOM_ID_ISSUE_NOTE);
  if (blanks.length > 0) {
    console.warn(
      `[CustomIdCheck] 경고: Custom ID 공란 ${blanks.length}행(자산 ${new Set(blanks.map((row) => row.assetId)).size}개). API로 받을 수 없는 값이라 직접 입력이 필요합니다.`,
    );
    for (const row of blanks.slice(0, 20)) {
      console.warn(`[CustomIdCheck] ${row.fileName} ${row.lineNumber}행 ${row.columnLetter}열 ${row.assetId} ${row.assetTitle}`);
    }
    if (blanks.length > 20) console.warn(`[CustomIdCheck] ... 외 ${blanks.length - 20}행`);
  }
  if (notes.length > 0) {
    console.warn(
      `[CustomIdCheck] 참고: CMS에 Custom ID가 여러 개 등록된 곡 ${new Set(notes.map((row) => row.assetId)).size}개(${notes.length}행)를 목록에 표시했습니다.`,
    );
  }
  console.warn(`[CustomIdCheck] Custom ID 확인 목록: ${outputPath}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
