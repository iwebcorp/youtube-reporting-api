import * as fs from "fs";
import * as path from "path";

export interface AppConfig {
  contentOwnerId: string;
  startDate: string;
  endDate: string;
  exchangeRate?: number;
  withholdingTaxRate?: number;
  usdPrecision: number;
  krwPrecision: number;
  excludeCountries: string[];
  reportDir: string;
  outputDir: string;
  cacheFile: string;
}

let configCache: AppConfig | null = null;

const DEFAULT_CONTENT_OWNER_ID = "2jFu0i9K0PE3MDrkU_UUfQ";

function getPreviousMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  const format = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  return { startDate: format(start), endDate: format(end) };
}

export function loadConfig(): AppConfig {
  if (configCache !== null) {
    return configCache;
  }

  const configPath = path.join(process.cwd(), "config.json");
  const raw = fs.existsSync(configPath)
    ? (JSON.parse(fs.readFileSync(configPath, "utf-8")) as Partial<AppConfig>)
    : {};
  const previousMonth = getPreviousMonthRange();

  const baseConfig: AppConfig = {
    contentOwnerId: raw.contentOwnerId ?? DEFAULT_CONTENT_OWNER_ID,
    startDate: raw.startDate ?? previousMonth.startDate,
    endDate: raw.endDate ?? previousMonth.endDate,
    usdPrecision: raw.usdPrecision ?? 6,
    krwPrecision: raw.krwPrecision ?? 2,
    excludeCountries: (raw.excludeCountries ?? ["US"]).map((country) => country.toUpperCase()),
    reportDir: raw.reportDir ?? "reports",
    outputDir: raw.outputDir ?? ".",
    cacheFile: raw.cacheFile ?? "asset_metadata_cache.json",
  };

  if (typeof raw.exchangeRate === "number") {
    baseConfig.exchangeRate = raw.exchangeRate;
  }
  if (typeof raw.withholdingTaxRate === "number") {
    baseConfig.withholdingTaxRate = raw.withholdingTaxRate;
  }

  configCache = baseConfig;

  return baseConfig;
}
