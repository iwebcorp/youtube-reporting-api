import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse";
import { csvEscape, ensureDirectory, parseCliArgs } from "./reporting/utils.js";

type MetadataRecord = {
  customId?: string;
};

type CsvRecord = Record<string, string>;

interface AddCustomIdOptions {
  yearMonth: string;
  reportDir: string;
  outputDir: string;
  cacheFile: string;
}

function resolveOptions(): AddCustomIdOptions {
  const cliOptions = parseCliArgs(process.argv.slice(2));
  const yearMonth = cliOptions.yearMonth ?? "202603";
  if (!/^\d{6}$/.test(yearMonth)) {
    throw new Error(`--yearMonth must be YYYYMM. Received: ${yearMonth}`);
  }

  return {
    yearMonth,
    reportDir: path.resolve(process.cwd(), cliOptions.reportDir ?? "reports"),
    outputDir: path.resolve(process.cwd(), cliOptions.outputDir ?? `reports_custom_id_${yearMonth}`),
    cacheFile: path.resolve(process.cwd(), cliOptions.cacheFile ?? "asset_metadata_cache.json"),
  };
}

function loadCustomIdByAssetId(cacheFile: string): Map<string, string> {
  const raw = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Record<string, MetadataRecord>;
  const customIdByAssetId = new Map<string, string>();

  for (const [assetId, metadata] of Object.entries(raw)) {
    const customId = String(metadata.customId ?? "").trim();
    if (assetId && customId) {
      customIdByAssetId.set(assetId, customId);
    }
  }

  return customIdByAssetId;
}

function isTargetCsv(filePath: string, reportDir: string, yearMonth: string): boolean {
  if (!filePath.toLowerCase().endsWith(".csv")) return false;

  const relativePath = path.relative(reportDir, filePath);
  const normalizedYearMonth = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}`;

  return (
    path.basename(filePath).includes(normalizedYearMonth) ||
    relativePath.split(path.sep).includes("system-managed") && path.basename(filePath).startsWith(`${yearMonth}_`)
  );
}

function listCsvFiles(dir: string, reportDir: string, yearMonth: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCsvFiles(fullPath, reportDir, yearMonth));
    } else if (entry.isFile() && isTargetCsv(fullPath, reportDir, yearMonth)) {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function buildHeaders(headers: string[]): { outputHeaders: string[]; assetIdHeader: string | null; customIdHeader: string } {
  const assetIdHeader = headers.find((header) => header.trim().toLowerCase() === "asset_id") ?? null;
  const existingCustomIdHeader = headers.find((header) => header.trim().toLowerCase() === "custom_id");

  if (!assetIdHeader) {
    return { outputHeaders: headers, assetIdHeader: null, customIdHeader: existingCustomIdHeader ?? "custom_id" };
  }

  if (existingCustomIdHeader) {
    return { outputHeaders: headers, assetIdHeader, customIdHeader: existingCustomIdHeader };
  }

  const assetIdIndex = headers.indexOf(assetIdHeader);
  const outputHeaders = [
    ...headers.slice(0, assetIdIndex + 1),
    "custom_id",
    ...headers.slice(assetIdIndex + 1),
  ];
  return { outputHeaders, assetIdHeader, customIdHeader: "custom_id" };
}

async function transformCsvFile(
  inputPath: string,
  outputPath: string,
  customIdByAssetId: Map<string, string>,
): Promise<{ rows: number; filled: number; skipped: boolean }> {
  ensureDirectory(path.dirname(outputPath));

  const parser = fs.createReadStream(inputPath).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }),
  ) as AsyncIterable<CsvRecord> & { columns?: string[] };

  const writer = fs.createWriteStream(outputPath, { encoding: "utf-8" });
  let outputHeaders: string[] | null = null;
  let assetIdHeader: string | null = null;
  let customIdHeader = "custom_id";
  let rows = 0;
  let filled = 0;

  for await (const row of parser) {
    if (!outputHeaders) {
      const headers = Object.keys(row);
      const headerInfo = buildHeaders(headers);
      outputHeaders = headerInfo.outputHeaders;
      assetIdHeader = headerInfo.assetIdHeader;
      customIdHeader = headerInfo.customIdHeader;
      writer.write(`${outputHeaders.join(",")}\n`);
    }

    rows += 1;
    const assetId = assetIdHeader ? String(row[assetIdHeader] ?? "").trim() : "";
    const existingCustomId = String(row[customIdHeader] ?? "").trim();
    const customId = existingCustomId || customIdByAssetId.get(assetId) || "";
    if (!existingCustomId && customId) {
      filled += 1;
    }

    const outputRow: CsvRecord = { ...row, [customIdHeader]: customId };
    writer.write(`${outputHeaders.map((header) => csvEscape(outputRow[header] ?? "")).join(",")}\n`);
  }

  await new Promise<void>((resolve, reject) => {
    writer.end(() => resolve());
    writer.on("error", reject);
  });

  return { rows, filled, skipped: !assetIdHeader };
}

async function run(): Promise<void> {
  const options = resolveOptions();
  const customIdByAssetId = loadCustomIdByAssetId(options.cacheFile);
  const files = listCsvFiles(options.reportDir, options.reportDir, options.yearMonth);

  console.log(`[CustomId] Metadata loaded: ${customIdByAssetId.size} asset custom IDs`);
  console.log(`[CustomId] Target files: ${files.length}`);
  ensureDirectory(options.outputDir);

  let totalRows = 0;
  let totalFilled = 0;
  for (const file of files) {
    const relativePath = path.relative(options.reportDir, file);
    const outputPath = path.join(options.outputDir, relativePath);
    const result = await transformCsvFile(file, outputPath, customIdByAssetId);
    totalRows += result.rows;
    totalFilled += result.filled;
    console.log(
      `[CustomId] ${relativePath} rows=${result.rows} filled=${result.filled}${result.skipped ? " skipped_no_asset_id" : ""}`,
    );
  }

  console.log(`[CustomId] Completed. outputDir=${options.outputDir} rows=${totalRows} filled=${totalFilled}`);
}

run().catch((error) => {
  console.error("[CustomId] Failed.", error);
  process.exitCode = 1;
});
