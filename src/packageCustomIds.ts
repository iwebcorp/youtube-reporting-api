// 4단계: Custom ID 확인 목록의 공란을 Asset ID별로 보여주고, 사용자가 입력한 값을 전달용 정산 파일 원본에 써 넣는다.
import * as fs from "fs";
import * as path from "path";
import { parse as parseCsv } from "csv-parse/sync";
import {
  CUSTOM_ID_ISSUE_BLANK,
  customIdInputFileName,
  getMonthlyPaths,
} from "./monthlyReadiness.js";
import { CsvFileWriter, assertWritable, rewriteCsvFile } from "./reporting/csvFile.js";

const CUSTOM_ID_HEADER = "Custom ID";
const ASSET_ID_HEADER = "Asset ID";

export interface BlankCustomIdAsset {
  assetId: string;
  assetTitle: string;
  rows: number;
  files: string[];
}

function readIssueList(yearMonth: string): { filePath: string; header: string[]; records: string[][] } | null {
  const filePath = path.join(getMonthlyPaths(yearMonth).customIdDir, customIdInputFileName(yearMonth));
  if (!fs.existsSync(filePath)) return null;
  const [header = [], ...records] = parseCsv(fs.readFileSync(filePath, "utf-8"), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];
  return { filePath, header, records };
}

export function listBlankCustomIdAssets(yearMonth: string): BlankCustomIdAsset[] {
  const list = readIssueList(yearMonth);
  if (!list) return [];
  const column = (name: string) => list.header.indexOf(name);
  const [kind, file, assetId, assetTitle] = ["유형", "파일", "Asset ID", "Asset Title"].map(column);
  const assets = new Map<string, BlankCustomIdAsset>();
  for (const record of list.records) {
    if (record[kind!] !== CUSTOM_ID_ISSUE_BLANK) continue;
    const id = record[assetId!] ?? "";
    const asset = assets.get(id) ?? { assetId: id, assetTitle: record[assetTitle!] ?? "", rows: 0, files: [] };
    asset.rows += 1;
    const fileName = record[file!] ?? "";
    if (!asset.files.includes(fileName)) asset.files.push(fileName);
    assets.set(id, asset);
  }
  return [...assets.values()];
}

// 입력값: Asset ID → Custom ID. 빈 값은 건너뛴다. 공란 목록에 없는 Asset ID는 받지 않는다.
export async function fillBlankCustomIds(
  yearMonth: string,
  input: Record<string, unknown>,
): Promise<{ filledRows: number; filledAssets: number; remainingRows: number }> {
  const blanks = new Map(listBlankCustomIdAssets(yearMonth).map((asset) => [asset.assetId, asset]));
  const values = new Map<string, string>();
  for (const [assetId, raw] of Object.entries(input)) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    if (!blanks.has(assetId)) throw new Error(`Custom ID 공란 목록에 없는 Asset ID입니다: ${assetId}`);
    if (/[\r\n\t]/.test(value)) throw new Error(`Custom ID에 줄바꿈이나 탭을 넣을 수 없습니다: ${assetId}`);
    values.set(assetId, value);
  }
  if (values.size === 0) throw new Error("입력한 Custom ID가 없습니다.");

  const { packageDir } = getMonthlyPaths(yearMonth);
  const files = new Set([...values.keys()].flatMap((assetId) => blanks.get(assetId)!.files));
  // 일부 파일만 바뀐 채 멈추지 않도록, 고칠 파일이 모두 Excel 등에서 닫혀 있는지 먼저 확인한다.
  for (const filePath of [...[...files].map((fileName) => path.join(packageDir, fileName)), readIssueList(yearMonth)!.filePath]) {
    assertWritable(filePath);
  }
  let filledRows = 0;
  for (const fileName of files) {
    await rewriteCsvFile(path.join(packageDir, fileName), CUSTOM_ID_HEADER, (record, columns) => {
      const customId = columns.get(CUSTOM_ID_HEADER)!;
      const value = values.get((record[columns.get(ASSET_ID_HEADER) ?? -1] ?? "").trim());
      if (!value || (record[customId] ?? "").trim()) return record;
      const next = [...record];
      while (next.length <= customId) next.push("");
      next[customId] = value;
      filledRows += 1;
      return next;
    });
  }

  // 채운 자산의 공란 행을 확인 목록에서 지운다. 행을 지우지 않았으므로 남은 행 번호는 그대로 맞다.
  const list = readIssueList(yearMonth)!;
  const [kind, assetId] = [list.header.indexOf("유형"), list.header.indexOf("Asset ID")];
  const remaining = list.records.filter((record) => !(record[kind] === CUSTOM_ID_ISSUE_BLANK && values.has(record[assetId] ?? "")));
  if (remaining.length === 0) {
    fs.unlinkSync(list.filePath);
  } else {
    const writer = new CsvFileWriter(list.filePath);
    await writer.write(list.header);
    for (const record of remaining) await writer.write(record);
    await writer.close();
  }
  return {
    filledRows,
    filledAssets: values.size,
    remainingRows: remaining.filter((record) => record[kind] === CUSTOM_ID_ISSUE_BLANK).length,
  };
}
