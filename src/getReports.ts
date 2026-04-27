import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

function toMonthDateRange(yearMonth: string): { start: Date; end: Date } {
  const year = Number(yearMonth.slice(0, 4));
  const monthIndex = Number(yearMonth.slice(4, 6)) - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999)),
  };
}

async function getReports() {
  const cliArgs = process.argv.slice(2);
  const extractionConfig = resolveExtractionConfig(parseCliArgs(cliArgs));
  const hasExplicitYearMonth = cliArgs.some((argument) => argument.startsWith("--yearMonth="));
  const range = hasExplicitYearMonth
    ? toMonthDateRange(extractionConfig.yearMonth)
    : {
        start: new Date(cfg.startDate),
        end: new Date(cfg.endDate),
      };
  range.start.setHours(0, 0, 0, 0);
  range.end.setHours(23, 59, 59, 999);
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
    const filteredReports = reports.filter((report) => {
      if (!report.startTime) return false;
      const reportDate = new Date(report.startTime);
      return reportDate >= range.start && reportDate <= range.end;
    });

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

getReports().catch(console.error);
