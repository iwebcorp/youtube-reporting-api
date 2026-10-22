import * as fs from "fs";
import * as path from "path";
import { REPORT_TYPES, UNKNOWN_TEXT_VALUES } from "./constants.js";
import type {
  AssetMetadata,
  CsvRow,
  ExtractionCliOptions,
  ExtractionConfig,
  ReportFileGroup,
} from "./types.js";
import { loadConfig } from "../configLoader.js";

export function clean(value: unknown): string {
  const normalized = String(value ?? "").replace(/\uFEFF/g, "").trim();
  if (UNKNOWN_TEXT_VALUES.has(normalized.toLowerCase())) {
    return "";
  }
  return normalized;
}

export function csvEscape(value: unknown): string {
  return `"${clean(value).replace(/"/g, '""')}"`;
}

export function normalizeCustomId(value: unknown): string {
  const normalized = clean(value);
  // 단일 영문 값은 사용자가 기존 값을 확인하고 전달용 CSV에서 직접 수정하도록 보존한다.
  return /^\d+$/.test(normalized) || isEnglishCustomId(normalized) ? normalized : "";
}

export function isEnglishCustomId(value: string): boolean {
  return /[A-Za-z]/.test(value) && !/[,;|\r\n\t]/.test(value);
}

export function normalizeHeader(header: string): string {
  return clean(header).toLowerCase().replace(/[_\s:()-]+/g, "");
}

export function parseCliArgs(argv: string[]): ExtractionCliOptions {
  const options: ExtractionCliOptions = {};
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const trimmed = argument.slice(2);
    const hasExplicitValue = trimmed.includes("=");
    const [rawKey, ...rest] = trimmed.split("=");
    const value = rest.join("=");

    if (!hasExplicitValue) {
      switch (rawKey) {
        case "with-classification":
        case "withClassification":
          options.withClassification = true;
          break;
        default:
          console.warn(`[Args] Ignored unsupported option: --${rawKey}`);
      }
      continue;
    }

    if (!value) continue;
    switch (rawKey) {
      case "yearMonth":
        options.yearMonth = value;
        break;
      case "reportDir":
        options.reportDir = value;
        break;
      case "outputDir":
        options.outputDir = value;
        break;
      case "neighboringDir":
        options.neighboringDir = value;
        break;
      case "publishingDir":
        options.publishingDir = value;
        break;
      case "systemManagedDir":
        options.systemManagedDir = value;
        break;
      case "publishingSystemManagedDir":
        options.publishingSystemManagedDir = value;
        break;
      case "sampleDir":
        options.sampleDir = value;
        break;
      case "with-classification":
      case "withClassification":
        options.withClassification = !["false", "0", "no", "off"].includes(value.toLowerCase());
        break;
      default:
        console.warn(`[Args] Ignored unsupported option: --${rawKey}`);
    }
  }
  return options;
}

export function resolveExtractionConfig(cliOptions: ExtractionCliOptions): ExtractionConfig {
  const appConfig = loadConfig();
  const inferredYearMonth = clean(appConfig.startDate).replace(/-/g, "").slice(0, 6);
  const yearMonth = clean(cliOptions.yearMonth ?? inferredYearMonth);

  if (!/^\d{6}$/.test(yearMonth)) {
    throw new Error(`[Config] yearMonth must be in YYYYMM format. Received: "${yearMonth}"`);
  }

  return {
    yearMonth,
    reportDir: path.resolve(process.cwd(), clean(cliOptions.reportDir ?? appConfig.reportDir)),
    outputDir: path.resolve(process.cwd(), clean(cliOptions.outputDir ?? appConfig.outputDir)),
    neighboringDir: path.resolve(
      process.cwd(),
      clean(cliOptions.neighboringDir ?? path.join(appConfig.reportDir, "system-managed-assets")),
    ),
    publishingDir: path.resolve(
      process.cwd(),
      clean(cliOptions.publishingDir ?? path.join(appConfig.reportDir, "system-managed-assets-pla")),
    ),
    systemManagedDir: path.resolve(
      process.cwd(),
      clean(cliOptions.systemManagedDir ?? path.join(appConfig.reportDir, "system-managed")),
    ),
    publishingSystemManagedDir: path.resolve(
      process.cwd(),
      clean(cliOptions.publishingSystemManagedDir ?? cliOptions.systemManagedDir ?? path.join(appConfig.reportDir, "system-managed")),
    ),
    sampleDir: path.resolve(process.cwd(), clean(cliOptions.sampleDir ?? "2026415샘플")),
  };
}

export function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function parseNumber(value: string, context: string): number {
  const cleaned = clean(value);
  if (!cleaned) {
    return 0;
  }

  const numeric = Number(cleaned.replace(/,/g, ""));
  if (Number.isNaN(numeric)) {
    console.warn(`[Parse] Invalid numeric value in ${context}: "${value}". Falling back to 0.`);
    return 0;
  }
  return numeric;
}

export function formatDateKey(reportDate: string): string {
  return reportDate.replace(/-/g, "");
}

export function listMonthlyReportGroups(reportDir: string, yearMonth: string): ReportFileGroup[] {
  if (!fs.existsSync(reportDir)) {
    throw new Error(`[Files] Report directory does not exist: ${reportDir}`);
  }

  const files = fs.readdirSync(reportDir).filter((fileName) => {
    if (!fileName.endsWith(".csv")) {
      return false;
    }
    const matchedDate = extractReportDate(fileName);
    return matchedDate !== null && formatDateKey(matchedDate).startsWith(yearMonth);
  });

  const grouped = new Map<string, ReportFileGroup>();
  for (const fileName of files) {
    const reportDate = extractReportDate(fileName);
    if (!reportDate) continue;

    const entry = grouped.get(reportDate) ?? {
      reportDate,
      dateKey: formatDateKey(reportDate),
      revenueFiles: [],
      usageFiles: [],
    };

    const fullPath = path.join(reportDir, fileName);
    if (fileName.includes(REPORT_TYPES.revenue)) {
      entry.revenueFiles.push(fullPath);
    } else if (fileName.includes(REPORT_TYPES.usage)) {
      entry.usageFiles.push(fullPath);
    }

    grouped.set(reportDate, entry);
  }

  return Array.from(grouped.values())
    .filter((group) => group.revenueFiles.length > 0 || group.usageFiles.length > 0)
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate));
}

export function extractReportDate(fileName: string): string | null {
  const matched = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  return matched?.[1] ?? null;
}

export function listMonthlySystemManagedFiles(
  systemManagedDir: string,
  yearMonth: string,
  reportTypeId: string,
): string[] {
  if (!fs.existsSync(systemManagedDir)) {
    return [];
  }

  const latestByCoverage = new Map<string, { fileName: string; createLabel: string }>();

  for (const fileName of fs.readdirSync(systemManagedDir)) {
    if (!fileName.endsWith(".csv")) {
      continue;
    }
    const prefix = `${yearMonth}_${reportTypeId}_`;
    if (!fileName.startsWith(prefix)) {
      continue;
    }

    const suffix = fileName.slice(prefix.length, -4);
    const [startLabel, endLabel, createLabel] = suffix.split("_");
    if (!startLabel?.startsWith(yearMonth) || createLabel === undefined) {
      continue;
    }

    const coverageKey = `${startLabel}|${endLabel ?? ""}`;
    const existing = latestByCoverage.get(coverageKey);
    if (!existing || createLabel > existing.createLabel) {
      latestByCoverage.set(coverageKey, { fileName, createLabel });
    }
  }

  return Array.from(latestByCoverage.values())
    .map((entry) => path.join(systemManagedDir, entry.fileName))
    .sort((left, right) => left.localeCompare(right));
}

export function findFirstValue(row: CsvRow, aliases: string[]): string {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.includes(normalizeHeader(key))) {
      return clean(value);
    }
  }
  return "";
}

export function normalizeMetadata(metadata: Partial<AssetMetadata> & Pick<AssetMetadata, "assetId">): AssetMetadata {
  const normalized: AssetMetadata = {
    assetId: metadata.assetId,
    title: clean(metadata.title),
    customId: clean(metadata.customId),
    isrc: clean(metadata.isrc),
    iswc: clean(metadata.iswc),
    hfa: clean(metadata.hfa),
    upc: clean(metadata.upc),
    writers: clean(metadata.writers),
    artist: clean(metadata.artist),
    album: clean(metadata.album),
    label: clean(metadata.label),
    assetType: clean(metadata.assetType),
    musicClaimType: clean(metadata.musicClaimType),
    compositionRightType: clean(metadata.compositionRightType),
    channelId: clean(metadata.channelId),
  };
  if (metadata.sourceCategory !== undefined) {
    normalized.sourceCategory = metadata.sourceCategory;
  }
  return normalized;
}
