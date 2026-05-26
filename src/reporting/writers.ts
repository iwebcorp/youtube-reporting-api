import * as fs from "fs";
import * as path from "path";
import iconv from "iconv-lite";
import { NEIGHBORING_HEADERS, PUBLISHING_HEADERS } from "./constants.js";
import type { NeighboringWriters, PublishingWriters } from "./types.js";
import { ensureDirectory } from "./utils.js";

type EncodedWriter = NodeJS.WritableStream & { __fileStream?: fs.WriteStream };

function openEncodedWriter(filePath: string, initialContent?: string): EncodedWriter {
  const fileStream = fs.createWriteStream(filePath);
  const encoder = iconv.encodeStream("cp949");
  encoder.pipe(fileStream);
  if (initialContent) {
    encoder.write(initialContent);
  }
  (encoder as EncodedWriter).__fileStream = fileStream;
  return encoder as EncodedWriter;
}

function openCsvWriter(filePath: string, header: string): NodeJS.WritableStream {
  return openEncodedWriter(filePath, header);
}

function openTextWriter(filePath: string): NodeJS.WritableStream {
  return openEncodedWriter(filePath);
}

export function createNeighboringWriters(outputDir: string): NeighboringWriters {
  ensureDirectory(outputDir);
  return {
    dailyAd: openCsvWriter(path.join(outputDir, "1_neighboring_daily_ad.csv"), NEIGHBORING_HEADERS.dailyAd),
    dailyAdAdjustment: openCsvWriter(path.join(outputDir, "2_neighboring_daily_ad_adj.csv"), NEIGHBORING_HEADERS.dailyAd),
    monthlySubscription: openCsvWriter(
      path.join(outputDir, "3_neighboring_monthly_sub.csv"),
      NEIGHBORING_HEADERS.monthlySubscription,
    ),
    financialDetail: openCsvWriter(
      path.join(outputDir, "4_neighboring_financial_detail.csv"),
      NEIGHBORING_HEADERS.financialDetail,
    ),
  };
}

export function createPublishingWriters(outputDir: string): PublishingWriters {
  ensureDirectory(outputDir);
  return {
    dailyAd: openCsvWriter(path.join(outputDir, "1_publishing_daily_ad.csv"), PUBLISHING_HEADERS.dailyAd),
    dailyAdAdjustment: openCsvWriter(
      path.join(outputDir, "2_publishing_daily_ad_adj.csv"),
      PUBLISHING_HEADERS.dailyAdAdjustment,
    ),
    monthlySubscription: openCsvWriter(
      path.join(outputDir, "3_publishing_monthly_sub.csv"),
      PUBLISHING_HEADERS.monthlySubscription,
    ),
    ddexDsr: openTextWriter(path.join(outputDir, "4_publishing_ddex_dsr.csv")),
  };
}

export async function closeWriters(writers: NodeJS.WritableStream[]): Promise<void> {
  await Promise.all(
    writers.map(
      (writer) =>
        new Promise<void>((resolve, reject) => {
          const encodedWriter = writer as EncodedWriter;
          const fileStream = encodedWriter.__fileStream;
          const fail = (error: Error) => reject(error);
          writer.once("error", fail);
          fileStream?.once("error", fail);
          writer.end(() => {
            if (!fileStream) {
              resolve();
              return;
            }
            fileStream.once("finish", () => resolve());
          });
        }),
    ),
  );
}
