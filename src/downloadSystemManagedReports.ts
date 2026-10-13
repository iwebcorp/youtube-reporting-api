import * as fs from "fs";
import * as path from "path";
import type { Readable } from "stream";
import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { parseCliArgs, resolveExtractionConfig, ensureDirectory, clean } from "./reporting/utils.js";
import { loadConfig } from "./configLoader.js";
import { getErrorMessage, isDeletedOAuthClientError, withRetries } from "./reporting/retry.js";

const DEFAULT_REPORT_TYPES = [
  "content_owner_asset_ad_revenue_raw_a1",
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
  "music_content_owner_asset_red_revenue_raw_a1",
  "music_content_owner_asset_red_adjustment_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_summary_a1",
  "music_content_owner_shorts_revenue_summary_a1",
  "content_owner_payments_summary_a1",
];
const MAX_DOWNLOAD_ATTEMPTS = 5;
const MAX_API_ATTEMPTS = 5;

function parseReportTypeIds(argv: string[]): string[] {
  const explicit = argv
    .filter((argument) => argument.startsWith("--reportTypeIds="))
    .flatMap((argument) => clean(argument.slice("--reportTypeIds=".length)).split(","))
    .map((value) => clean(value))
    .filter(Boolean);

  return explicit.length > 0 ? explicit : DEFAULT_REPORT_TYPES;
}

function parseContentOwnerId(argv: string[], fallback: string): string {
  const argument = argv.find((value) => value.startsWith("--contentOwnerId="));
  return argument ? clean(argument.slice("--contentOwnerId=".length)) : fallback;
}

function parseLatestOnly(argv: string[]): boolean {
  const argument = argv.find((value) => value === "--latestOnly" || value.startsWith("--latestOnly="));
  if (!argument || argument === "--latestOnly") {
    return Boolean(argument);
  }
  const value = clean(argument.slice("--latestOnly=".length)).toLowerCase();
  return !["false", "0", "no", "off"].includes(value);
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

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const extractionArgv = argv.filter(
    (argument) =>
      !argument.startsWith("--contentOwnerId=")
      && !argument.startsWith("--reportTypeIds=")
      && argument !== "--latestOnly"
      && !argument.startsWith("--latestOnly="),
  );
  const config = resolveExtractionConfig(parseCliArgs(extractionArgv));
  const reportTypeIds = parseReportTypeIds(argv);
  const latestOnly = parseLatestOnly(argv);
  const cfg = loadConfig();
  const contentOwnerId = parseContentOwnerId(argv, cfg.contentOwnerId);
  const auth = await getAuthClient();
  const yt = google.youtubereporting({ version: "v1", auth });

  ensureDirectory(config.systemManagedDir);
  console.log(`[SystemManaged] yearMonth=${config.yearMonth} dir=${config.systemManagedDir}`);
  console.log(`[SystemManaged] contentOwnerId=${contentOwnerId}`);
  console.log(`[SystemManaged] target report types: ${reportTypeIds.join(", ")}`);
  console.log(`[SystemManaged] latestOnly=${latestOnly}`);

  let pageToken: string | undefined;
  const jobs: { id: string; reportTypeId: string }[] = [];
  do {
    const response = await withRetries("jobs.list", MAX_API_ATTEMPTS, () =>
      yt.jobs.list({
        onBehalfOfContentOwner: contentOwnerId,
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
    const matchingReports: Array<{
      downloadUrl: string;
      startTime?: string | null;
      endTime?: string | null;
      createTime?: string | null;
    }> = [];
    do {
      const response = await withRetries(`jobs.reports.list:${job.id}`, MAX_API_ATTEMPTS, () =>
        yt.jobs.reports.list({
          onBehalfOfContentOwner: contentOwnerId,
          jobId: job.id,
          ...(reportPageToken ? { pageToken: reportPageToken } : {}),
        }),
      );

      for (const report of response.data.reports ?? []) {
        if (!report.downloadUrl || !isMatchingMonth(report, config.yearMonth)) {
          continue;
        }
        matchingReports.push({
          downloadUrl: report.downloadUrl,
          ...(report.startTime !== undefined ? { startTime: report.startTime } : {}),
          ...(report.endTime !== undefined ? { endTime: report.endTime } : {}),
          ...(report.createTime !== undefined ? { createTime: report.createTime } : {}),
        });
      }

      reportPageToken = response.data.nextPageToken ?? undefined;
    } while (reportPageToken);

    const selectedReports = latestOnly
      ? matchingReports
          .sort((left, right) => clean(right.startTime).localeCompare(clean(left.startTime)))
          .slice(0, 1)
      : matchingReports;
    console.log(
      `[SystemManaged] ${job.reportTypeId} matching=${matchingReports.length} selected=${selectedReports.length}`,
    );

    for (const report of selectedReports) {
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
          await downloadFile(auth, report.downloadUrl, outputPath);
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
  if (isDeletedOAuthClientError(error)) {
    console.error(
      "[SystemManaged] Google OAuth 클라이언트가 삭제되어 인증할 수 없습니다. Google Cloud의 Google Auth Platform > Clients > Deleted credentials에서 클라이언트를 복원한 뒤 다시 실행하세요.",
    );
  } else {
    console.error(`[SystemManaged] Download failed: ${getErrorMessage(error)}`);
  }
  process.exitCode = 1;
});
