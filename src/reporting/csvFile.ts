// 사용자가 Excel로 고쳐 저장했을 수 있는 정산 CSV를 인코딩을 판별해 읽고, Excel용 UTF-8 BOM CSV로 쓴다.
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

export class CsvFileWriter {
  private readonly partialPath: string;
  private readonly stream: fs.WriteStream;

  public constructor(private readonly filePath: string) {
    this.partialPath = `${filePath}.partial`;
    this.stream = fs.createWriteStream(this.partialPath, { encoding: "utf-8" });
    this.stream.write("﻿");
  }

  public async write(values: string[]): Promise<void> {
    if (!this.stream.write(`${values.map(escapeCell).join(",")}\n`)) {
      await once(this.stream, "drain");
    }
  }

  public async close(): Promise<void> {
    this.stream.end();
    await once(this.stream, "finish");
    fs.renameSync(this.partialPath, this.filePath);
  }
}
