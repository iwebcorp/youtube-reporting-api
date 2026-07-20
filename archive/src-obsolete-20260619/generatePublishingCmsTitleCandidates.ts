import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { pathToFileURL } from "url";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
import { loadJson } from "./validatePublishingRoyaltyCandidates.js";

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

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseOption(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function findCmsFile(cmsDir: string, yearMonth: string, matcher: (fileName: string) => boolean): string {
  const prefix = `${yearMonth}01`;
  const matched = fs.readdirSync(cmsDir).find((fileName) => fileName.includes(prefix) && matcher(fileName));
  if (!matched) {
    throw new Error(`[GeneratePublishingCmsTitleCandidates] No CMS file matched for ${yearMonth} in ${cmsDir}.`);
  }
  return path.join(cmsDir, matched);
}

async function sumTitlesFromCsv(
  filePath: string,
  selectedTitles: string[],
  options?: { skipLeadingSummaryLine?: boolean },
): Promise<number> {
  const titleSet = new Set(selectedTitles.map((value) => value.trim()));
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let headers: string[] | null = null;
  let skippedSummary = false;
  let total = 0;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) {
      continue;
    }
    if (options?.skipLeadingSummaryLine && !skippedSummary && line === "Asset Summary") {
      skippedSummary = true;
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }

    const values = parseCsvLine(line);
    if (values.length !== headers.length) {
      continue;
    }

    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const title = String(row["Asset Title"] ?? "").trim();
    if (!titleSet.has(title)) {
      continue;
    }

    const revenue = Number(row["Partner Revenue"] ?? "0");
    total += Number.isFinite(revenue) ? revenue : 0;
  }

  return total;
}

function buildEntry(source: CmsTitleCandidateEntry, actual: number): CmsTitleCandidateEntry {
  return {
    target: actual,
    actual,
    diff: 0,
    titles: source.titles,
  };
}

export async function runGeneratePublishingCmsTitleCandidates(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const sourceYearMonth = parseOption(cliArgs, "sourceYearMonth") ?? "202604";
  const cmsDir = path.resolve(process.cwd(), parseOption(cliArgs, "cmsDir") ?? "from _cms");
  const sourcePath = path.resolve(process.cwd(), `publishing_royalty_${sourceYearMonth}_cms_title_candidates.json`);
  const outputPath = path.resolve(process.cwd(), `publishing_royalty_${config.yearMonth}_cms_title_candidates.json`);

  const source = loadJson<CmsTitleCandidateFile>(sourcePath);
  const adPath = findCmsFile(
    cmsDir,
    config.yearMonth,
    (fileName) => fileName.includes("_asset_raw_") && !fileName.includes("red_label_rawdata_asset"),
  );
  const subPath = findCmsFile(cmsDir, config.yearMonth, (fileName) => fileName.includes("red_label_rawdata_asset"));
  const audioPath = findCmsFile(
    cmsDir,
    config.yearMonth,
    (fileName) => fileName.includes("Audio_Tier_") && fileName.includes("Financial_Detail"),
  );

  const adActual = await sumTitlesFromCsv(adPath, source.publishing_daily_ad.titles);
  const subActual = await sumTitlesFromCsv(subPath, source.publishing_monthly_sub.titles, {
    skipLeadingSummaryLine: true,
  });
  const audioActual = await sumTitlesFromCsv(audioPath, source.publishing_ddex_dsr.titles);

  const generated: CmsTitleCandidateFile = {
    publishing_daily_ad: buildEntry(source.publishing_daily_ad, adActual),
    publishing_monthly_sub: buildEntry(source.publishing_monthly_sub, subActual),
    publishing_ddex_dsr: buildEntry(source.publishing_ddex_dsr, audioActual),
  };

  fs.writeFileSync(outputPath, JSON.stringify(generated, null, 2) + "\n", "utf8");
  console.log(`[GeneratePublishingCmsTitleCandidates] Wrote ${outputPath}`);
  console.log(`- publishing_daily_ad=${adActual.toFixed(12)}`);
  console.log(`- publishing_monthly_sub=${subActual.toFixed(12)}`);
  console.log(`- publishing_ddex_dsr=${audioActual.toFixed(12)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runGeneratePublishingCmsTitleCandidates().catch((error) => {
    console.error("[GeneratePublishingCmsTitleCandidates] Generation failed.", error);
    process.exitCode = 1;
  });
}
