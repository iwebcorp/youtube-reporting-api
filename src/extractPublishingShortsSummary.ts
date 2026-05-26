import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import iconv from "iconv-lite";
import { parseCsvRows } from "./reporting/parsers.js";
import { csvEscape, ensureDirectory, listMonthlySystemManagedFiles, parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

const SHORTS_HEADERS = [
  "Payment Period",
  "Country",
  "Shorts Monthly Pool USD",
  "Pool Participating Rate",
  "Shorts Usages Marketshare",
  "Shorts Flat Fee Revenue USD",
] as const;

type ShortsRow = Record<string, string>;

function writeRows(outputPath: string, rows: ShortsRow[]): void {
  const lines = [
    SHORTS_HEADERS.join(","),
    ...rows.map((row) =>
      SHORTS_HEADERS.map((header) => {
        switch (header) {
          case "Payment Period":
            return csvEscape(row.payment_period ?? "");
          case "Country":
            return csvEscape(row.country ?? "");
          case "Shorts Monthly Pool USD":
            return row.shorts_monthly_pool_usd ?? "0";
          case "Pool Participating Rate":
            return row.pool_participating_rate ?? "0";
          case "Shorts Usages Marketshare":
            return row.shorts_usages_marketshare ?? "0";
          case "Shorts Flat Fee Revenue USD":
            return row.shorts_flat_fee_revenue_usd ?? "0";
          default:
            return "";
        }
      }).join(","),
    ),
  ];

  fs.writeFileSync(outputPath, iconv.encode(`${lines.join("\n")}\n`, "cp949"));
}

export async function runPublishingShortsSummary(cliArgs: string[] = process.argv.slice(2)): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  ensureDirectory(config.outputDir);

  const sourceFiles = listMonthlySystemManagedFiles(
    config.systemManagedDir,
    config.yearMonth,
    "music_content_owner_shorts_revenue_summary_a1",
  );

  const rows: ShortsRow[] = [];
  for (const filePath of sourceFiles) {
    rows.push(...(await parseCsvRows(filePath)));
  }

  rows.sort((left, right) => {
    const leftRevenue = Number(left.shorts_flat_fee_revenue_usd ?? 0);
    const rightRevenue = Number(right.shorts_flat_fee_revenue_usd ?? 0);
    if (leftRevenue !== rightRevenue) {
      return rightRevenue - leftRevenue;
    }
    return String(left.country ?? "").localeCompare(String(right.country ?? ""));
  });

  const outputPath = path.join(config.outputDir, "5_publishing_shorts_revenue_summary.csv");
  writeRows(outputPath, rows);
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.shorts_flat_fee_revenue_usd ?? 0), 0);
  console.log(`[PublishingShorts] Wrote ${outputPath}. rows=${rows.length} total=${totalRevenue.toFixed(9)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPublishingShortsSummary().catch((error) => {
    console.error("[PublishingShorts] Extraction failed.", error);
    process.exitCode = 1;
  });
}
