// 전달용 정산 파일에서 금액(Shorts 상세는 Engaged Views)이 0인 행을 지운다(docs/팡수.md 각 항목 1번).
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { SHORTS_VIDEO_FILE } from "./monthlyReadiness.js";
import { rewriteCsvFile } from "./reporting/csvFile.js";
import { isZero, parseDecimal } from "./reporting/decimal.js";

// 파일별로 0인지 볼 열. 5_neighboring_payment_summary는 대상이 아니다.
export const ZERO_ROW_COLUMNS: Record<string, string> = {
  "1_neighboring_daily_ad.csv": "Partner Revenue",
  "2_neighboring_daily_ad_adj.csv": "Partner Revenue",
  "3_neighboring_monthly_sub.csv": "Partner Revenue",
  "4_neighboring_financial_detail.csv": "Partner Revenue",
  "5_publishing_shorts_revenue_summary.csv": "Shorts Flat Fee Revenue USD",
  [SHORTS_VIDEO_FILE]: "Engaged Views",
  "1_publishing_daily_ad.csv": "Partner Revenue",
  "2_publishing_daily_ad_adj.csv": "Partner Revenue",
  "3_publishing_monthly_sub.csv": "Partner Revenue",
};

// 값이 정확히 0일 때만 true. 0.0001 같은 작은 값과 빈 칸은 남긴다.
export function isZeroAmount(text: string): boolean {
  const value = parseDecimal(text);
  return text.trim() !== "" && value !== null && isZero(value);
}

export async function removeZeroRows(packageDir: string): Promise<void> {
  for (const [fileName, column] of Object.entries(ZERO_ROW_COLUMNS)) {
    const filePath = path.join(packageDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`[ZeroRows] 정산 파일이 없습니다: ${filePath}`);
    }
    const { kept, removed } = await rewriteCsvFile(filePath, column, (record, columns) =>
      isZeroAmount(record[columns.get(column)!] ?? "") ? null : record,
    );
    console.log(`[ZeroRows] ${fileName} ${column}=0 행 ${removed}개 삭제, 남은 행 ${kept}개`);
  }
}

function getOption(argv: string[], name: string): string {
  const prefix = `--${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const packageDir = getOption(process.argv.slice(2), "packageDir");
  (packageDir ? removeZeroRows(packageDir) : Promise.reject(new Error("[ZeroRows] --packageDir가 필요합니다.")))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
