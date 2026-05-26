import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import iconv from "iconv-lite";
import { parseCsvRows, parseRedSummaryFiles } from "./reporting/parsers.js";
import { csvEscape, ensureDirectory, listMonthlySystemManagedFiles, parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

export interface SummaryRow {
  revenueType: string;
  adjustmentType: string;
  partnerRevenueUsd: number;
}

function sumNumericField(rows: Record<string, string>[], field: string): number {
  let total = 0;
  for (const row of rows) {
    total += Number(row[field] ?? 0);
  }
  return total;
}

export async function buildSummaryRows(yearMonth: string, systemManagedDir: string): Promise<SummaryRow[]> {
  const adRevenueFiles = listMonthlySystemManagedFiles(
    systemManagedDir,
    yearMonth,
    "content_owner_asset_ad_revenue_raw_a1",
  );
  const adAdjustmentFiles = listMonthlySystemManagedFiles(
    systemManagedDir,
    yearMonth,
    "content_owner_asset_ad_adjustment_revenue_raw_a1",
  );
  const redRevenueFiles = listMonthlySystemManagedFiles(
    systemManagedDir,
    yearMonth,
    "music_content_owner_asset_red_revenue_raw_a1",
  );
  const redAdjustmentFiles = listMonthlySystemManagedFiles(
    systemManagedDir,
    yearMonth,
    "music_content_owner_asset_red_adjustment_revenue_raw_a1",
  );
  const audioTierSummaryFiles = listMonthlySystemManagedFiles(
    systemManagedDir,
    yearMonth,
    "content_owner_claim_audio_tier_revenue_summary_a1",
  );
  const shortsSummaryFiles = listMonthlySystemManagedFiles(
    systemManagedDir,
    yearMonth,
    "music_content_owner_shorts_revenue_summary_a1",
  );

  const rows: SummaryRow[] = [];

  let adsRevenue = 0;
  for (const filePath of adRevenueFiles) {
    adsRevenue += sumNumericField(await parseCsvRows(filePath), "partner_revenue");
  }
  rows.push({
    revenueType: "Ads Revenue",
    adjustmentType: "None",
    partnerRevenueUsd: adsRevenue,
  });

  const adAdjustments = new Map<string, number>();
  for (const filePath of adAdjustmentFiles) {
    for (const row of await parseCsvRows(filePath)) {
      const adjustmentType = row["adjustment_type"]?.trim() || "None";
      adAdjustments.set(
        adjustmentType,
        (adAdjustments.get(adjustmentType) ?? 0) + Number(row["partner_revenue"] ?? 0),
      );
    }
  }
  for (const [adjustmentType, partnerRevenueUsd] of adAdjustments.entries()) {
    rows.push({
      revenueType: "Ads Revenue",
      adjustmentType,
      partnerRevenueUsd,
    });
  }

  const redRevenueMap = await parseRedSummaryFiles(redRevenueFiles);
  let redRevenue = 0;
  for (const entry of redRevenueMap.values()) {
    redRevenue += entry.partnerRevenue;
  }
  rows.push({
    revenueType: "Subscriptions Revenue - YouTube Premium / Music Premium",
    adjustmentType: "None",
    partnerRevenueUsd: redRevenue,
  });

  const redAdjustmentMap = await parseRedSummaryFiles(redAdjustmentFiles);
  const redAdjustments = new Map<string, number>();
  for (const entry of redAdjustmentMap.values()) {
    redAdjustments.set(
      entry.adjustmentType,
      (redAdjustments.get(entry.adjustmentType) ?? 0) + entry.partnerRevenue,
    );
  }
  for (const [adjustmentType, partnerRevenueUsd] of redAdjustments.entries()) {
    rows.push({
      revenueType: "Subscriptions Revenue - YouTube Premium / Music Premium",
      adjustmentType,
      partnerRevenueUsd,
    });
  }

  let audioTierRevenue = 0;
  for (const filePath of audioTierSummaryFiles) {
    audioTierRevenue += sumNumericField(await parseCsvRows(filePath), "audio_royalties");
  }
  rows.push({
    revenueType: "Audio Tier Revenue",
    adjustmentType: "None",
    partnerRevenueUsd: audioTierRevenue,
  });

  let shortsRevenue = 0;
  for (const filePath of shortsSummaryFiles) {
    shortsRevenue += sumNumericField(await parseCsvRows(filePath), "shorts_flat_fee_revenue_usd");
  }
  rows.push({
    revenueType: "Shorts Revenue - Music Dynamic Pool",
    adjustmentType: "None",
    partnerRevenueUsd: shortsRevenue,
  });

  return rows;
}

export async function sumApiSettlementTotal(yearMonth: string, systemManagedDir: string): Promise<number> {
  const rows = await buildSummaryRows(yearMonth, systemManagedDir);
  return rows.reduce((sum, row) => sum + row.partnerRevenueUsd, 0);
}

export async function runApiSettlementSummary(cliArgs: string[] = process.argv.slice(2)): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  ensureDirectory(config.outputDir);

  const rows = await buildSummaryRows(config.yearMonth, config.systemManagedDir);
  const total = rows.reduce((sum, row) => sum + row.partnerRevenueUsd, 0);
  const outputPath = path.join(config.outputDir, `0_api_settlement_summary_${config.yearMonth}.csv`);
  const csvRows = [
    [
      "Revenue Type",
      "Adjustment Type",
      "Partner Revenue (USD)",
      "Local Currency Code",
      "Partner Revenue (Local Currency Code)",
    ].join(","),
    ...rows.map((row) =>
      [
        csvEscape(row.revenueType),
        csvEscape(row.adjustmentType),
        row.partnerRevenueUsd.toFixed(9),
        "USD",
        row.partnerRevenueUsd.toFixed(9),
      ].join(","),
    ),
    [csvEscape("Total"), "", total.toFixed(9), "", total.toFixed(9)].join(","),
  ];

  fs.writeFileSync(outputPath, iconv.encode(`${csvRows.join("\n")}\n`, "cp949"));
  console.log(`[SettlementSummary] Wrote ${outputPath}. rows=${rows.length} total=${total.toFixed(9)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runApiSettlementSummary().catch((error) => {
    console.error("[SettlementSummary] Extraction failed.", error);
    process.exitCode = 1;
  });
}
