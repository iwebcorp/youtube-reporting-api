// 사용자가 Excel로 고쳐 저장했을 수 있는 정산 CSV를 인코딩을 판별해 읽고, Excel용 UTF-8 BOM 또는 원래 인코딩으로 쓴다.
import * as fs from "fs";
import { once } from "events";
import { parse } from "csv-parse";
import iconv from "iconv-lite";

export type TextEncoding = "utf-8" | "cp949";

// 추출 결과는 CP949, Excel의 "CSV UTF-8" 저장본은 UTF-8이므로 파일 전체가 올바른 UTF-8인지로 구분한다.
export async function detectEncoding(filePath: string): Promise<TextEncoding> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const chunk of fs.createReadStream(filePath)) {
      decoder.decode(chunk as Buffer, { stream: true });
    }
    decoder.decode();
    return "utf-8";
  } catch {
    return "cp949";
  }
}

export async function* readCsvRecords(filePath: string): AsyncIterable<{ record: string[]; line: number }> {
  const encoding = await detectEncoding(filePath);
  const records = fs
    .createReadStream(filePath)
    .pipe(iconv.decodeStream(encoding))
    .pipe(parse({ bom: true, relax_column_count: true, skip_empty_lines: true, info: true })) as AsyncIterable<{
      record: string[];
      info: { lines: number };
    }>;
  for await (const { record, info } of records) {
    // Excel이 남기는 쉼표만 있는 빈 행은 건너뛴다.
    if (record.every((value) => value.trim() === "")) continue;
    // csv-parse의 lines는 레코드가 끝난 줄 번호라 Excel 행 번호와 같다.
    yield { record, line: info.lines };
  }
}

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

// 기본은 Excel용 UTF-8 BOM이고, 추출 결과(CP949)를 고쳐 쓸 때는 원래 인코딩을 지정한다.
export class CsvFileWriter {
  private readonly partialPath: string;
  private readonly stream: fs.WriteStream;

  public constructor(private readonly filePath: string, private readonly encoding: TextEncoding = "utf-8") {
    this.partialPath = `${filePath}.partial`;
    this.stream = fs.createWriteStream(this.partialPath);
    if (encoding === "utf-8") this.stream.write("﻿");
  }

  public async write(values: string[]): Promise<void> {
    const line = `${values.map(escapeCell).join(",")}\n`;
    if (!this.stream.write(this.encoding === "cp949" ? iconv.encode(line, "cp949") : line)) {
      await once(this.stream, "drain");
    }
  }

  public async close(): Promise<void> {
    this.stream.end();
    await once(this.stream, "finish");
    fs.renameSync(this.partialPath, this.filePath);
  }

  // 원본을 건드리지 않고 쓰던 임시 파일만 지운다.
  public async discard(): Promise<void> {
    this.stream.end();
    await once(this.stream, "finish");
    fs.rmSync(this.partialPath, { force: true });
  }
}

// 헤더 이름 → 열 번호. 같은 이름이 여러 번 나오면 첫 열을 쓴다.
export type HeaderColumns = Map<string, number>;

const HEADER_SEARCH_ROWS = 3;

// 정산 CSV를 같은 자리에 원래 인코딩으로 다시 쓴다. headerColumn이 있는 줄을 헤더로 보고, 그 위의 "Asset Summary" 같은 줄은 그대로 둔다.
// transform이 null을 돌려준 데이터 행은 지운다.
export async function rewriteCsvFile(
  filePath: string,
  headerColumn: string,
  transform: (record: string[], columns: HeaderColumns) => string[] | null,
): Promise<{ kept: number; removed: number }> {
  const encoding = await detectEncoding(filePath);
  const writer = new CsvFileWriter(filePath, encoding);
  let columns: HeaderColumns | undefined;
  let recordIndex = 0;
  let kept = 0;
  let removed = 0;
  try {
    for await (const { record } of readCsvRecords(filePath)) {
      recordIndex += 1;
      if (!columns) {
        const headers = record.map((value) => value.trim());
        if (headers.includes(headerColumn)) {
          columns = new Map();
          headers.forEach((header, index) => { if (!columns!.has(header)) columns!.set(header, index); });
        } else if (recordIndex >= HEADER_SEARCH_ROWS) {
          throw new Error(`${filePath}에서 '${headerColumn}' 열을 찾지 못했습니다.`);
        }
        await writer.write(record);
        continue;
      }
      const next = transform(record, columns);
      if (!next) {
        removed += 1;
        continue;
      }
      await writer.write(next);
      kept += 1;
    }
  } catch (error) {
    await writer.discard();
    throw error;
  }
  if (!columns) {
    await writer.discard();
    throw new Error(`${filePath}에서 '${headerColumn}' 열을 찾지 못했습니다.`);
  }
  await writer.close();
  return { kept, removed };
}
