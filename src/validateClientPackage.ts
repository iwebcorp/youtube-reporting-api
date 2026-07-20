import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { clean, parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

interface FileValidationSummary {
  fileName: string;
  headerMatch: boolean;
  sampleColumns: number;
  outputColumns: number;
  sampleRows: number;
  outputRows: number;
  sampledNullLikeRatio: number;
}

const FILE_MAPPINGS = [
  {
    fileName: "1_neighboring_daily_ad.csv",
    samplePath: path.join(process.cwd(), "인접", "1.YouTube_kwangsoomedia_M_20260101_asset_raw_v1-1.csv"),
  },
  {
    fileName: "2_neighboring_daily_ad_adj.csv",
    samplePath: path.join(process.cwd(), "인접", "2.YouTube_kwangsoomedia_M_20260101_ADJ_asset_raw_v1-1.csv"),
  },
  {
    fileName: "3_neighboring_monthly_sub.csv",
    samplePath: path.join(process.cwd(), "인접", "3.YouTube_kwangsoomedia_M_20260101_20260131_red_label_rawdata_asset_v1-1.csv"),
  },
  {
    fileName: "4_neighboring_financial_detail.csv",
    samplePath: path.join(process.cwd(), "인접", "4.YouTube_kwangsoomedia_Audio_Tier_20260101_Financial_Detail_v1-0.csv"),
  },
  {
    fileName: "1_publishing_daily_ad.csv",
    samplePath: path.join(process.cwd(), "저작", "1.YouTube_kwangsoomedia_pla_M_20260101_20260131_rev_views_by_asset_v1-0.csv"),
  },
  {
    fileName: "2_publishing_daily_ad_adj.csv",
    samplePath: path.join(process.cwd(), "저작", "2.YouTube_kwangsoomedia_pla_M_20260101_ADJ_asset_raw_v1-1.csv"),
  },
  {
    fileName: "3_publishing_monthly_sub.csv",
    samplePath: path.join(process.cwd(), "저작", "3.YouTube_kwangsoomedia_pla_M_20260101_20260131_red_pubs_rawdata_asset_v1-1.csv"),
  },
] as const;

function splitLine(line: string, delimiter: "," | "\t"): string[] {
  return line.replace(/^\uFEFF/, "").split(delimiter);
}

async function inspectFile(
  filePath: string,
  delimiter: "," | "\t",
  fileName: string,
): Promise<{ header: string[]; rowCount: number; sampledNullLikeRatio: number }> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineIndex = 0;
  let rowCount = 0;
  let header: string[] = [];
  let sampleCellCount = 0;
  let sampleNullLikeCount = 0;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/\r$/, "");
    lineIndex += 1;
    rowCount += 1;

    if ((fileName === "3_neighboring_monthly_sub.csv" || fileName === "3_publishing_monthly_sub.csv") && lineIndex === 2) {
      header = splitLine(line, delimiter);
    } else if (lineIndex === 1 && fileName !== "3_neighboring_monthly_sub.csv" && fileName !== "3_publishing_monthly_sub.csv") {
      header = splitLine(line, delimiter);
    }

    if (lineIndex <= 5000 && lineIndex > 1) {
      for (const cell of splitLine(line, delimiter)) {
        sampleCellCount += 1;
        const value = clean(cell).toLowerCase();
        if (!value || value === "unknown" || value === "undefined" || value === "null" || value === "none") {
          sampleNullLikeCount += 1;
        }
      }
    }
  }

  return {
    header,
    rowCount,
    sampledNullLikeRatio: sampleCellCount === 0 ? 0 : sampleNullLikeCount / sampleCellCount,
  };
}

async function validateOutput(outputDir: string): Promise<FileValidationSummary[]> {
  const summaries: FileValidationSummary[] = [];

  for (const mapping of FILE_MAPPINGS) {
    const outputPath = path.join(outputDir, mapping.fileName);
    if (!fs.existsSync(outputPath)) {
      throw new Error(`[Validate] Missing output file: ${outputPath}`);
    }

    const sampleInfo = await inspectFile(mapping.samplePath, ",", mapping.fileName);
    const outputInfo = await inspectFile(outputPath, ",", mapping.fileName);

    summaries.push({
      fileName: mapping.fileName,
      headerMatch: sampleInfo.header.join("|") === outputInfo.header.join("|"),
      sampleColumns: sampleInfo.header.length,
      outputColumns: outputInfo.header.length,
      sampleRows: sampleInfo.rowCount,
      outputRows: outputInfo.rowCount,
      sampledNullLikeRatio: outputInfo.sampledNullLikeRatio,
    });
  }

  return summaries;
}

function printSummary(summaries: FileValidationSummary[]): void {
  console.log("[Validate] Client package comparison summary");
  for (const summary of summaries) {
    console.log(
      [
        `- ${summary.fileName}`,
        `headerMatch=${summary.headerMatch}`,
        `sampleColumns=${summary.sampleColumns}`,
        `outputColumns=${summary.outputColumns}`,
        `sampleRows=${summary.sampleRows}`,
        `outputRows=${summary.outputRows}`,
        `sampledNullLikeRatio=${(summary.sampledNullLikeRatio * 100).toFixed(2)}%`,
      ].join(" | "),
    );
  }
}

async function run(): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(process.argv.slice(2)));
  const summaries = await validateOutput(config.outputDir);
  printSummary(summaries);
}

run().catch((error) => {
  console.error("[Validate] Validation failed.", error);
  process.exitCode = 1;
});
