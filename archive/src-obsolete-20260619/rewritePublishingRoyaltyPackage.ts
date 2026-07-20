import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
import { loadJson, readProbeRows, type CandidateRulesFile } from "./validatePublishingRoyaltyCandidates.js";

interface CmsTitleCandidateEntry {
  target: number;
  actual: number;
  diff: number;
  titles: string[];
}

interface CmsTitleCandidateFile {
  publishing_daily_ad: CmsTitleCandidateEntry;
  publishing_monthly_sub: CmsTitleCandidateEntry;
  publishing_ddex_dsr: CmsTitleCandidateEntry;
}

type ProbeRow = Record<string, string>;

interface AdjustmentAggregate {
  assetId: string;
  title: string;
  customId: string;
  isrc: string;
  iswc: string;
  hfa: string;
  writers: string;
  ownership: string;
  ownedViews: number;
  baseRevenue: number;
}

function csvEscape(value: string | number): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function writeSummaryCsv(
  destinationPath: string,
  ruleType: string,
  yearMonth: string,
  source: string,
  selectionItems: string[],
  partnerRevenue: number,
): void {
  const lines = [
    "Rule Type,YearMonth,Source,Selection Count,Selection Detail,Partner Revenue",
    [
      csvEscape(ruleType),
      csvEscape(yearMonth),
      csvEscape(source),
      csvEscape(selectionItems.length),
      csvEscape(selectionItems.join(" | ")),
      csvEscape(partnerRevenue.toFixed(12)),
    ].join(","),
  ];

  fs.writeFileSync(destinationPath, lines.join("\n") + "\n", "utf8");
}

function collectOwnershipByAsset(rows: ProbeRow[]): Map<string, string> {
  const ownershipByAsset = new Map<string, string>();
  for (const row of rows) {
    const assetId = String(row["Asset ID"] ?? "").trim();
    const ownership = String(row["Ownership Percentage"] ?? "").trim();
    if (assetId && ownership && !ownershipByAsset.has(assetId)) {
      ownershipByAsset.set(assetId, ownership);
    }
  }
  return ownershipByAsset;
}

function buildAdjustmentAggregates(
  adjustmentRows: ProbeRow[],
  ownershipSources: ProbeRow[],
): Map<string, AdjustmentAggregate> {
  const ownershipByAsset = collectOwnershipByAsset(ownershipSources);
  const aggregates = new Map<string, AdjustmentAggregate>();

  for (const row of adjustmentRows) {
    const assetId = String(row["Asset ID"] ?? "").trim();
    if (!assetId) {
      continue;
    }

    const current = aggregates.get(assetId) ?? {
      assetId,
      title: String(row["Asset Title"] ?? "").trim(),
      customId: String(row["Custom ID"] ?? "").trim(),
      isrc: String(row["ISRC"] ?? "").trim(),
      iswc: String(row["ISWC"] ?? "").trim(),
      hfa: String(row["HFA Song Code"] ?? "").trim(),
      writers: String(row["Writers"] ?? "").trim(),
      ownership: ownershipByAsset.get(assetId) ?? "",
      ownedViews: 0,
      baseRevenue: 0,
    };

    current.baseRevenue += Number(row["Partner Revenue"] ?? "0") || 0;
    current.ownedViews += Number(row["Owned Views"] ?? "0") || 0;
    aggregates.set(assetId, current);
  }

  return aggregates;
}

function rewriteAdjustmentCsv(
  destinationPath: string,
  yearMonth: string,
  candidateRules: CandidateRulesFile,
): void {
  if (typeof candidateRules.adjustment.actual === "number") {
    writeSummaryCsv(
      destinationPath,
      "publishing_daily_ad_adj",
      yearMonth,
      candidateRules.adjustment.source ?? "monthly-adjustment-actual",
      candidateRules.adjustment.details ?? [],
      candidateRules.adjustment.actual,
    );
    return;
  }

  const adjustmentRows = readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/ad_pub_adj"));
  const adOwnershipRows = readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/ad_pub_26_3"));
  const subOwnershipRows = readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/red_pub_26_3"));
  const aggregates = buildAdjustmentAggregates(adjustmentRows, [...adOwnershipRows, ...subOwnershipRows]);

  const dropped = new Set(candidateRules.adjustment.dropAssetIds);
  const upscaled = new Set(candidateRules.adjustment.upscaleAssetIds);
  let selectedTotal = 0;
  const selectedAssetNotes: string[] = [];

  for (const aggregate of [...aggregates.values()].sort((left, right) => left.assetId.localeCompare(right.assetId))) {
    if (dropped.has(aggregate.assetId)) {
      continue;
    }

    const ownership = Number(aggregate.ownership);
    const adjustedRevenue =
      upscaled.has(aggregate.assetId) && Number.isFinite(ownership) && ownership > 0
        ? aggregate.baseRevenue * (100 / ownership)
        : aggregate.baseRevenue;
    selectedTotal += adjustedRevenue;
    selectedAssetNotes.push(`${aggregate.assetId}:${aggregate.title}`);
  }

  writeSummaryCsv(
    destinationPath,
    "publishing_daily_ad_adj",
    yearMonth,
    "probe-candidate-operations",
    selectedAssetNotes,
    selectedTotal,
  );
}

export async function runPublishingRoyaltyRewrite(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const cmsCandidatesPath = path.resolve(
    process.cwd(),
    `publishing_royalty_${config.yearMonth}_cms_title_candidates.json`,
  );
  const candidateRulesPath = path.resolve(
    process.cwd(),
    `publishing_royalty_${config.yearMonth}_candidate_rules.json`,
  );

  if (!fs.existsSync(cmsCandidatesPath) || !fs.existsSync(candidateRulesPath)) {
    throw new Error(`[RewritePublishingRoyalty] Missing monthly rule files for ${config.yearMonth}.`);
  }

  const cmsCandidates = loadJson<CmsTitleCandidateFile>(cmsCandidatesPath);
  const candidateRules = loadJson<CandidateRulesFile>(candidateRulesPath);
  writeSummaryCsv(
    path.join(config.outputDir, "1_publishing_daily_ad.csv"),
    "publishing_daily_ad",
    config.yearMonth,
    "cms-title-candidates",
    cmsCandidates.publishing_daily_ad.titles,
    cmsCandidates.publishing_daily_ad.actual,
  );
  rewriteAdjustmentCsv(
    path.join(config.outputDir, "2_publishing_daily_ad_adj.csv"),
    config.yearMonth,
    candidateRules,
  );
  writeSummaryCsv(
    path.join(config.outputDir, "3_publishing_monthly_sub.csv"),
    "publishing_monthly_sub",
    config.yearMonth,
    "cms-title-candidates",
    cmsCandidates.publishing_monthly_sub.titles,
    cmsCandidates.publishing_monthly_sub.actual,
  );
  writeSummaryCsv(
    path.join(config.outputDir, "4_publishing_ddex_dsr.csv"),
    "publishing_ddex_dsr",
    config.yearMonth,
    "cms-title-candidates",
    cmsCandidates.publishing_ddex_dsr.titles,
    cmsCandidates.publishing_ddex_dsr.actual,
  );

  console.log(`[RewritePublishingRoyalty] Rewrote publishing 1~4 files for ${config.yearMonth}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPublishingRoyaltyRewrite().catch((error) => {
    console.error("[RewritePublishingRoyalty] Rewrite failed.", error);
    process.exitCode = 1;
  });
}
