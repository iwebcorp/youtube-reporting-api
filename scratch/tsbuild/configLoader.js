import * as fs from "fs";
import * as path from "path";
let configCache = null;
export function loadConfig() {
    if (configCache !== null) {
        return configCache;
    }
    const configPath = path.join(process.cwd(), "config.json");
    if (!fs.existsSync(configPath)) {
        console.error("[Config] Missing config.json in project root.");
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const requiredKeys = [
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
    const baseConfig = {
        contentOwnerId: raw.contentOwnerId,
        startDate: raw.startDate,
        endDate: raw.endDate,
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
    const settlementInfo = typeof baseConfig.exchangeRate === "number" && typeof baseConfig.withholdingTaxRate === "number"
        ? `, 환율: ${baseConfig.exchangeRate}, 원천세율: ${(baseConfig.withholdingTaxRate * 100).toFixed(0)}%`
        : "";
    console.log(`[Config] 설정 로드 완료 — 정산기간: ${baseConfig.startDate} ~ ${baseConfig.endDate}${settlementInfo}`);
    return baseConfig;
}
