import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  evaluateAdjustmentCandidate,
  loadJson,
  readProbeRows,
  type CandidateRulesFile,
  type PublishingRoyaltyTargetsFile,
} from "./validatePublishingRoyaltyCandidates.js";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

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

interface GateActuals {
  publishing_daily_ad: number;
  publishing_daily_ad_adj: number;
  publishing_monthly_sub: number;
  publishing_ddex_dsr: number;
  publishing_total: number;
}

const DEFAULT_TOLERANCE = 0.001;

function printComparison(
  targets: PublishingRoyaltyTargetsFile["targets"],
  actuals: GateActuals,
): { maxAbsDiff: number } {
  let maxAbsDiff = 0;
  console.log("[ValidatePublishingRoyaltyGate] Monthly publishing gate");

  for (const key of Object.keys(targets) as Array<keyof GateActuals>) {
    const expected = targets[key];
    const actual = actuals[key];
    const diff = actual - expected;
    maxAbsDiff = Math.max(maxAbsDiff, Math.abs(diff));
    console.log(
      `- ${key}: actual=${actual.toFixed(12)} | target=${expected.toFixed(12)} | diff=${diff.toFixed(12)}`,
    );
  }

  return { maxAbsDiff };
}

export async function runPublishingRoyaltyGate(
  cliArgs: string[] = process.argv.slice(2),
): Promise<{ actuals: GateActuals; maxAbsDiff: number }> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const targetsPath = path.resolve(process.cwd(), `publishing_royalty_${config.yearMonth}_targets.json`);
  const cmsCandidatesPath = path.resolve(
    process.cwd(),
    `publishing_royalty_${config.yearMonth}_cms_title_candidates.json`,
  );
  const candidateRulesPath = path.resolve(
    process.cwd(),
    `publishing_royalty_${config.yearMonth}_candidate_rules.json`,
  );

  if (!fs.existsSync(targetsPath)) {
    throw new Error(`[ValidatePublishingRoyaltyGate] Missing target file: ${targetsPath}`);
  }
  if (!fs.existsSync(cmsCandidatesPath)) {
    throw new Error(`[ValidatePublishingRoyaltyGate] Missing CMS title candidate file: ${cmsCandidatesPath}`);
  }
  if (!fs.existsSync(candidateRulesPath)) {
    throw new Error(`[ValidatePublishingRoyaltyGate] Missing candidate rules file: ${candidateRulesPath}`);
  }

  const targets = loadJson<PublishingRoyaltyTargetsFile>(targetsPath);
  const cmsCandidates = loadJson<CmsTitleCandidateFile>(cmsCandidatesPath);
  const candidateRules = loadJson<CandidateRulesFile>(candidateRulesPath);

  const adjustmentActual =
    typeof candidateRules.adjustment.actual === "number"
      ? candidateRules.adjustment.actual
      : evaluateAdjustmentCandidate(
          candidateRules.adjustment,
          readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/ad_pub_adj")),
          readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/ad_pub_26_3")),
          readProbeRows(path.resolve(process.cwd(), "scratch/xlsx_probe/red_pub_26_3")),
        ).selectedTotal;

  const actuals: GateActuals = {
    publishing_daily_ad: cmsCandidates.publishing_daily_ad.actual,
    publishing_daily_ad_adj: adjustmentActual,
    publishing_monthly_sub: cmsCandidates.publishing_monthly_sub.actual,
    publishing_ddex_dsr: cmsCandidates.publishing_ddex_dsr.actual,
    publishing_total:
      cmsCandidates.publishing_daily_ad.actual +
      adjustmentActual +
      cmsCandidates.publishing_monthly_sub.actual +
      cmsCandidates.publishing_ddex_dsr.actual,
  };

  const { maxAbsDiff } = printComparison(targets.targets, actuals);
  console.log(`- tolerance=${DEFAULT_TOLERANCE.toFixed(6)}`);
  console.log(`- maxAbsDiff=${maxAbsDiff.toFixed(12)}`);

  if (maxAbsDiff > DEFAULT_TOLERANCE) {
    throw new Error(
      `[ValidatePublishingRoyaltyGate] Monthly gate failed for ${config.yearMonth}. maxAbsDiff=${maxAbsDiff}`,
    );
  }

  return { actuals, maxAbsDiff };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPublishingRoyaltyGate().catch((error) => {
    console.error("[ValidatePublishingRoyaltyGate] Validation failed.", error);
    process.exitCode = 1;
  });
}
