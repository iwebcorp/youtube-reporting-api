import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

const cfg = loadConfig();

export function isReportInSelection(
  startTime: string | null | undefined,
  yearMonth: string | undefined,
  startDate: string,
  endDate: string,
): boolean {
  if (!startTime) return false;
  const reportDate = startTime.slice(0, 10);
  if (yearMonth) {
    return reportDate.slice(0, 7).replace("-", "") === yearMonth;
  }
  return reportDate >= startDate && reportDate <= endDate;
}

async function getReports() {
  const cliArgs = process.argv.slice(2);
  const extractionConfig = resolveExtractionConfig(parseCliArgs(cliArgs));
  const hasExplicitYearMonth = cliArgs.some((argument) => argument.startsWith("--yearMonth="));
  const selectedYearMonth = hasExplicitYearMonth ? extractionConfig.yearMonth : undefined;
  const rangeLabel = hasExplicitYearMonth ? extractionConfig.yearMonth : `${cfg.startDate} ~ ${cfg.endDate}`;

  const auth = await getAuthClient();
  const youtubereporting = google.youtubereporting({ version: "v1", auth });

  const jobsRes = await youtubereporting.jobs.list({
    onBehalfOfContentOwner: cfg.contentOwnerId,
  });
  const jobs = jobsRes.data.jobs || [];

  if (jobs.length === 0) {
    console.log("[Reports] No jobs found. Create reporting jobs first.");
    return;
  }

  const reportDir = extractionConfig.reportDir;
  fs.mkdirSync(reportDir, { recursive: true });
  console.log(`[Reports] jobs=${jobs.length} range=${rangeLabel} dir=${reportDir}`);

  for (const job of jobs) {
    console.log(`\n[Reports] Job ${job.name} (${job.reportTypeId})`);

    const reportsRes = await youtubereporting.jobs.reports.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
      jobId: job.id!,
    });

    const reports = reportsRes.data.reports || [];
    const filteredReports = reports.filter((report) =>
      isReportInSelection(report.startTime, selectedYearMonth, cfg.startDate, cfg.endDate),
    );

    if (filteredReports.length === 0) {
      console.log(` - No reports for ${rangeLabel}.`);
      continue;
    }

    console.log(` - Download candidates: ${filteredReports.length}`);

    for (const report of filteredReports) {
      const dateStr = report.startTime!.split("T")[0];
      const reportType = job.reportTypeId || "unknown";
      const fileName = `report_${dateStr}_${reportType}.csv`;
      const filePath = path.join(reportDir, fileName);

      if (fs.existsSync(filePath)) {
        console.log(`   [skip] ${fileName}`);
        continue;
      }

      console.log(`   [download] ${fileName}`);
      const response = await auth.request<any>({
        url: report.downloadUrl!,
        responseType: "stream",
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        response.data.on("error", reject);
      });
    }
  }

  console.log("\n[Reports] Download pass completed.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  getReports().catch(console.error);
}
