import * as fs from "fs";
import * as path from "path";
import { DEFAULT_DIRECTORIES, METADATA_FALLBACKS, REPORT_TYPES, UNKNOWN_TEXT_VALUES } from "./constants.js";
import { loadConfig } from "../configLoader.js";
export function clean(value) {
    const normalized = String(value ?? "").replace(/\uFEFF/g, "").trim();
    if (UNKNOWN_TEXT_VALUES.has(normalized.toLowerCase())) {
        return "";
    }
    return normalized;
}
export function csvEscape(value) {
    return `"${clean(value).replace(/"/g, '""')}"`;
}
export function normalizeHeader(header) {
    return clean(header).toLowerCase().replace(/[_\s:()-]+/g, "");
}
export function parseCliArgs(argv) {
    const options = {};
    for (const argument of argv) {
        if (!argument.startsWith("--"))
            continue;
        const [rawKey, ...rest] = argument.slice(2).split("=");
        const value = rest.join("=");
        if (!value)
            continue;
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
            case "cacheFile":
                options.cacheFile = value;
                break;
            default:
                console.warn(`[Args] Ignored unsupported option: --${rawKey}`);
        }
    }
    return options;
}
export function resolveExtractionConfig(cliOptions) {
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
        neighboringDir: path.resolve(process.cwd(), clean(cliOptions.neighboringDir ?? DEFAULT_DIRECTORIES.neighboring)),
        publishingDir: path.resolve(process.cwd(), clean(cliOptions.publishingDir ?? DEFAULT_DIRECTORIES.publishing)),
        cacheFile: path.resolve(process.cwd(), clean(cliOptions.cacheFile ?? appConfig.cacheFile)),
    };
}
export function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}
export function parseNumber(value, context) {
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
export function formatDateKey(reportDate) {
    return reportDate.replace(/-/g, "");
}
export function listMonthlyReportGroups(reportDir, yearMonth) {
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
    const grouped = new Map();
    for (const fileName of files) {
        const reportDate = extractReportDate(fileName);
        if (!reportDate)
            continue;
        const entry = grouped.get(reportDate) ?? {
            reportDate,
            dateKey: formatDateKey(reportDate),
            revenueFiles: [],
            usageFiles: [],
        };
        const fullPath = path.join(reportDir, fileName);
        if (fileName.includes(REPORT_TYPES.revenue)) {
            entry.revenueFiles.push(fullPath);
        }
        else if (fileName.includes(REPORT_TYPES.usage)) {
            entry.usageFiles.push(fullPath);
        }
        grouped.set(reportDate, entry);
    }
    return Array.from(grouped.values())
        .filter((group) => group.revenueFiles.length > 0 || group.usageFiles.length > 0)
        .sort((left, right) => left.reportDate.localeCompare(right.reportDate));
}
export function extractReportDate(fileName) {
    const matched = fileName.match(/(\d{4}-\d{2}-\d{2})/);
    return matched?.[1] ?? null;
}
export function loadJsonRecord(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    catch (error) {
        console.warn(`[Files] Failed to parse JSON file ${filePath}. Using empty record.`, error);
        return {};
    }
}
export function loadNeighboringUsageCache() {
    const cache = loadJsonRecord(path.resolve(process.cwd(), "usage_data_cache.json"));
    const normalized = {};
    for (const [assetId, entry] of Object.entries(cache)) {
        normalized[assetId] = {
            total: Number(entry.total ?? 0),
            watchPage: Number(entry.watchPage ?? 0),
            embedded: Number(entry.embedded ?? 0),
            channelPage: Number(entry.channelPage ?? 0),
            live: Number(entry.live ?? 0),
            onDemand: Number(entry.onDemand ?? 0),
            adEnabled: Number(entry.adEnabled ?? 0),
        };
    }
    return normalized;
}
export function loadPublishingUsageCache() {
    const cache = loadJsonRecord(path.resolve(process.cwd(), "publishing_usage_cache.json"));
    const normalized = {};
    for (const [assetId, entry] of Object.entries(cache)) {
        normalized[assetId] = {
            totalRevenue: Number(entry.totalRevenue ?? 0),
            adRevenue: Number(entry.adRevenue ?? 0),
            subRevenue: Number(entry.subRevenue ?? 0),
            totalViews: Number(entry.totalViews ?? 0),
            watchPageViews: Number(entry.watchPageViews ?? 0),
            embeddedViews: Number(entry.embeddedViews ?? 0),
            channelPageViews: Number(entry.channelPageViews ?? 0),
            liveViews: Number(entry.liveViews ?? 0),
            onDemandViews: Number(entry.onDemandViews ?? 0),
            adEnabledViews: Number(entry.adEnabledViews ?? 0),
            adsenseRevenue: Number(entry.adsenseRevenue ?? 0),
            doubleclickServedYouTubeSoldRevenue: Number(entry.doubleclickServedYouTubeSoldRevenue ?? 0),
            doubleclickServedPartnerSoldRevenue: Number(entry.doubleclickServedPartnerSoldRevenue ?? 0),
            partnerServedPartnerSoldRevenue: Number(entry.partnerServedPartnerSoldRevenue ?? 0),
        };
    }
    return normalized;
}
export function findFirstValue(row, aliases) {
    const normalizedAliases = aliases.map(normalizeHeader);
    for (const [key, value] of Object.entries(row)) {
        if (normalizedAliases.includes(normalizeHeader(key))) {
            return clean(value);
        }
    }
    return "";
}
export function withMetadataFallbacks(metadata) {
    const cleanedWriters = clean(metadata.writers);
    const cleanedArtist = clean(metadata.artist);
    const normalized = {
        assetId: metadata.assetId,
        title: clean(metadata.title) || METADATA_FALLBACKS.title,
        customId: clean(metadata.customId) || METADATA_FALLBACKS.customId,
        isrc: clean(metadata.isrc) || METADATA_FALLBACKS.isrc,
        iswc: clean(metadata.iswc) || METADATA_FALLBACKS.iswc,
        hfa: clean(metadata.hfa) || METADATA_FALLBACKS.hfa,
        upc: clean(metadata.upc) || METADATA_FALLBACKS.upc,
        writers: (cleanedWriters && cleanedWriters !== METADATA_FALLBACKS.writers ? cleanedWriters : "") ||
            cleanedArtist ||
            METADATA_FALLBACKS.writers,
        artist: cleanedArtist || METADATA_FALLBACKS.artist,
        album: clean(metadata.album) || METADATA_FALLBACKS.album,
        label: clean(metadata.label) || METADATA_FALLBACKS.label,
        assetType: clean(metadata.assetType) || METADATA_FALLBACKS.assetType,
        musicClaimType: clean(metadata.musicClaimType) || METADATA_FALLBACKS.musicClaimType,
        compositionRightType: clean(metadata.compositionRightType) || METADATA_FALLBACKS.compositionRightType,
        channelId: clean(metadata.channelId) || METADATA_FALLBACKS.channelId,
    };
    if (metadata.sourceCategory !== undefined) {
        normalized.sourceCategory = metadata.sourceCategory;
    }
    return normalized;
}
