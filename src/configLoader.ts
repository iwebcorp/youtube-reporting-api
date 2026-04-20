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

export function loadConfig(): AppConfig {
  if (configCache !== null) {
    return configCache;
  }

  const configPath = path.join(process.cwd(), "config.json");
  if (!fs.existsSync(configPath)) {
    console.error("[Config] Missing config.json in project root.");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Partial<AppConfig>;
  const requiredKeys: Array<keyof Pick<AppConfig, "contentOwnerId" | "startDate" | "endDate">> = [
    "contentOwnerId",
    "startDate",
    "endDate",
  ];

  for (const key of requiredKeys) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") {
      console.error(`[Config] Missing required field "${key}" in config.json.`);
      process.exit(1);
    }
  }

  const baseConfig: AppConfig = {
    contentOwnerId: raw.contentOwnerId as string,
    startDate: raw.startDate as string,
    endDate: raw.endDate as string,
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

  const settlementInfo =
    typeof baseConfig.exchangeRate === "number" && typeof baseConfig.withholdingTaxRate === "number"
      ? `, 환율: ${baseConfig.exchangeRate}, 원천세율: ${(baseConfig.withholdingTaxRate * 100).toFixed(0)}%`
      : "";

  console.log(
    `[Config] 설정 로드 완료 — 정산기간: ${baseConfig.startDate} ~ ${baseConfig.endDate}${settlementInfo}`,
  );

  return baseConfig;
}
