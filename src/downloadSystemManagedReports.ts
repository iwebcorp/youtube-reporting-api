import * as fs from "fs";
import * as path from "path";
import type { Readable } from "stream";
import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { parseCliArgs, resolveExtractionConfig, ensureDirectory, clean } from "./reporting/utils.js";
import { loadConfig } from "./configLoader.js";

const DEFAULT_REPORT_TYPES = [
  "content_owner_asset_ad_revenue_raw_a1",
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
];
const MAX_DOWNLOAD_ATTEMPTS = 5;
const MAX_API_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1500;

function parseReportTypeIds(argv: string[]): string[] {
  const explicit = argv
    .filter((argument) => argument.startsWith("--reportTypeIds="))
    .flatMap((argument) => clean(argument.slice("--reportTypeIds=".length)).split(","))
    .map((value) => clean(value))
    .filter(Boolean);

  return explicit.length > 0 ? explicit : DEFAULT_REPORT_TYPES;
}

function toMonthDateRange(yearMonth: string): { start: Date; end: Date } {
  const year = Number(yearMonth.slice(0, 4));
  const monthIndex = Number(yearMonth.slice(4, 6)) - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0)),
  };
}

function isMatchingMonth(report: { startTime?: string | null; endTime?: string | null }, yearMonth: string): boolean {
  const range = toMonthDateRange(yearMonth);
  const startTime = report.startTime ? new Date(report.startTime) : null;
  return Boolean(startTime && startTime >= range.start && startTime < range.end);
}

async function downloadFile(
  auth: Awaited<ReturnType<typeof getAuthClient>>,
  downloadUrl: string,
  outputPath: string,
): Promise<void> {
  const partialPath = `${outputPath}.partial`;
  if (fs.existsSync(partialPath)) {
    fs.unlinkSync(partialPath);
  }

  const response = await auth.request({
    url: downloadUrl,
    responseType: "stream",
  });
  const stream = response.data as Readable;

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(partialPath);
    let settled = false;
    const finalizeError = (error: unknown) => {
      if (settled) return;
      settled = true;
      writer.destroy();
      stream.destroy?.();
      reject(error);
    };

    stream.once("error", finalizeError);
    writer.once("error", finalizeError);
    writer.once("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });

    stream.pipe(writer);
  });

  fs.renameSync(partialPath, outputPath);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRetryableError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).toLowerCase() : "";
  const status =
    typeof error === "object" && error !== null && "status" in error ? Number(error.status) : undefined;

  return (
    ["econnreset", "etimedout", "eai_again", "socket hang up", "timeout", "503", "502", "500"].some((token) =>
      message.includes(token) || code.includes(token),
    ) ||
    (status !== undefined && [429, 500, 502, 503, 504].includes(status))
  );
}

async function withRetries<T>(
  label: string,
  maxAttempts: number,
  fn: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = BASE_RETRY_DELAY_MS * attempt;
      console.warn(
        `[Retry] ${label} failed on attempt ${attempt}/${maxAttempts}: ${getErrorMessage(error)}. Retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function run(): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(process.argv.slice(2)));
  const reportTypeIds = parseReportTypeIds(process.argv.slice(2));
  const cfg = loadConfig();
  const auth = await getAuthClient();
  const yt = google.youtubereporting({ version: "v1", auth });

  ensureDirectory(config.systemManagedDir);
  console.log(`[SystemManaged] yearMonth=${config.yearMonth} dir=${config.systemManagedDir}`);
  console.log(`[SystemManaged] target report types: ${reportTypeIds.join(", ")}`);

  let pageToken: string | undefined;
  const jobs: { id: string; reportTypeId: string }[] = [];
  do {
    const response = await withRetries("jobs.list", MAX_API_ATTEMPTS, () =>
      yt.jobs.list({
        onBehalfOfContentOwner: cfg.contentOwnerId,
        includeSystemManaged: true,
        ...(pageToken ? { pageToken } : {}),
      }),
    );

    for (const job of response.data.jobs ?? []) {
      if (job.id && job.reportTypeId && reportTypeIds.includes(job.reportTypeId)) {
        jobs.push({ id: job.id, reportTypeId: job.reportTypeId });
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  console.log(`[SystemManaged] matched jobs=${jobs.length}`);
  const failedFiles: string[] = [];
  for (const job of jobs) {
    let reportPageToken: string | undefined;
    do {
      const response = await withRetries(`jobs.reports.list:${job.id}`, MAX_API_ATTEMPTS, () =>
        yt.jobs.reports.list({
          onBehalfOfContentOwner: cfg.contentOwnerId,
          jobId: job.id,
          ...(reportPageToken ? { pageToken: reportPageToken } : {}),
        }),
      );

      for (const report of response.data.reports ?? []) {
        if (!report.downloadUrl || !isMatchingMonth(report, config.yearMonth)) {
          continue;
        }

        const startLabel = clean(report.startTime).slice(0, 10).replace(/-/g, "");
        const endLabel = clean(report.endTime).slice(0, 10).replace(/-/g, "");
        const createLabel = clean(report.createTime).slice(0, 10).replace(/-/g, "");
        const fileName = `${config.yearMonth}_${job.reportTypeId}_${startLabel}_${endLabel}_${createLabel}.csv`;
        const outputPath = path.join(config.systemManagedDir, fileName);

        if (fs.existsSync(outputPath)) {
          console.log(`[SystemManaged] Skip existing ${fileName}`);
          continue;
        }

        try {
          console.log(`[SystemManaged] Downloading ${fileName}`);
          await withRetries(`download:${fileName}`, MAX_DOWNLOAD_ATTEMPTS, async () => {
            await downloadFile(auth, report.downloadUrl!, outputPath);
          });
        } catch (error) {
          const partialPath = `${outputPath}.partial`;
          if (fs.existsSync(partialPath)) {
            fs.unlinkSync(partialPath);
          }
          failedFiles.push(fileName);
          console.error(`[SystemManaged] Failed ${fileName}: ${getErrorMessage(error)}`);
        }
      }

      reportPageToken = response.data.nextPageToken ?? undefined;
    } while (reportPageToken);
  }

  if (failedFiles.length > 0) {
    console.error(`[SystemManaged] Completed with ${failedFiles.length} failed downloads.`);
    for (const fileName of failedFiles) {
      console.error(`[SystemManaged] Pending retry ${fileName}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[SystemManaged] All matching downloads completed.");
}

run().catch((error) => {
  console.error("[SystemManaged] Download failed.", error);
  process.exitCode = 1;
});
