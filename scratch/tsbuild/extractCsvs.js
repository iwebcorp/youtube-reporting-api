import { pathToFileURL } from "url";
import { AssetClassifier } from "./assetClassifier.js";
import { createNeighboringWriters, closeWriters } from "./reporting/writers.js";
import { mergeRevenueAndUsage, parseRevenueFiles, parseUsageFiles } from "./reporting/parsers.js";
import { csvEscape, listMonthlyReportGroups, parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
function buildMonthlyKey(assetId, country, month) {
    return `${assetId}|${country}|${month}`;
}
function accumulateMonthlySummary(record, month, monthlyRevenueMap) {
    if (record.subscriptionRevenue <= 0) {
        return;
    }
    const key = buildMonthlyKey(record.assetId, record.country, month);
    const existing = monthlyRevenueMap.get(key) ?? {
        assetId: record.assetId,
        country: record.country,
        month,
        revenue: 0,
        views: 0,
    };
    existing.revenue += record.subscriptionRevenue;
    existing.views += record.views;
    monthlyRevenueMap.set(key, existing);
}
function writeDailyReports(dateKey, records, classifier, writers) {
    for (const record of records) {
        if (record.partnerRevenue <= 0 && record.subscriptionRevenue <= 0) {
            continue;
        }
        if (classifier.classify(record.assetId) !== "Neighboring") {
            continue;
        }
        const metadata = classifier.getMetadata(record.assetId);
        const adRevenue = record.partnerRevenue - record.subscriptionRevenue;
        const targetWriter = record.adjustmentType === "None" ? writers.dailyAd : writers.dailyAdAdjustment;
        const summaryRow = [
            record.adjustmentType,
            dateKey,
            record.country,
            record.assetId,
            csvEscape(metadata.title),
            "",
            metadata.channelId,
            metadata.assetType,
            metadata.customId,
            metadata.isrc,
            metadata.upc,
            "",
            csvEscape(metadata.artist),
            csvEscape(metadata.album),
            csvEscape(metadata.label),
            "no",
            String(record.views),
            adRevenue.toFixed(6),
            "0",
            "0",
            "0",
            adRevenue.toFixed(6),
            adRevenue.toFixed(6),
            "0",
            "0",
            "0",
            adRevenue.toFixed(6),
        ];
        targetWriter.write(`${summaryRow.join(",")}\n`);
        if (record.videos.length > 0 && record.views > 0) {
            for (const video of record.videos) {
                const ratio = video.views > 0 ? video.views / record.views : 0;
                const allocatedAdRevenue = adRevenue * ratio;
                const detailRow = [
                    record.adjustmentType,
                    dateKey,
                    record.country,
                    video.videoId,
                    record.assetId,
                    csvEscape(metadata.title),
                    "",
                    metadata.customId,
                    metadata.isrc,
                    metadata.upc,
                    "",
                    csvEscape(metadata.artist),
                    csvEscape(metadata.album),
                    csvEscape(metadata.label),
                    String(video.views),
                    allocatedAdRevenue.toFixed(6),
                    allocatedAdRevenue.toFixed(6),
                    "0",
                    allocatedAdRevenue.toFixed(6),
                ];
                writers.financialDetail.write(`${detailRow.join(",")}\n`);
            }
            continue;
        }
        const detailRow = [
            record.adjustmentType,
            dateKey,
            record.country,
            "",
            record.assetId,
            csvEscape(metadata.title),
            "",
            metadata.customId,
            metadata.isrc,
            metadata.upc,
            "",
            csvEscape(metadata.artist),
            csvEscape(metadata.album),
            csvEscape(metadata.label),
            String(record.views),
            adRevenue.toFixed(6),
            adRevenue.toFixed(6),
            "0",
            adRevenue.toFixed(6),
        ];
        writers.financialDetail.write(`${detailRow.join(",")}\n`);
    }
}
function writeMonthlySummary(monthlyRevenueMap, classifier, writers) {
    for (const summary of monthlyRevenueMap.values()) {
        const metadata = classifier.getMetadata(summary.assetId);
        const revenue = summary.revenue.toFixed(6);
        const row = [
            "None",
            summary.month,
            summary.country,
            summary.assetId,
            csvEscape(metadata.title),
            "",
            metadata.assetType,
            metadata.customId,
            metadata.isrc,
            metadata.upc,
            "",
            csvEscape(metadata.artist),
            csvEscape(metadata.album),
            csvEscape(metadata.label),
            "UGC",
            "Music",
            "YouTube Premium monthly",
            String(summary.views),
            "0",
            String(summary.views),
            String(summary.views),
            revenue,
            "0",
            "0",
            revenue,
            "0",
            revenue,
        ];
        writers.monthlySubscription.write(`${row.join(",")}\n`);
    }
}
async function processDay(group, classifier, writers, monthlyRevenueMap, yearMonth) {
    console.log(`[Neighboring] Processing ${group.reportDate}. revenueFiles=${group.revenueFiles.length}, usageFiles=${group.usageFiles.length}`);
    const revenueMap = await parseRevenueFiles(group.revenueFiles);
    const usageMap = await parseUsageFiles(group.usageFiles);
    const mergedRecords = mergeRevenueAndUsage(revenueMap, usageMap);
    writeDailyReports(group.dateKey, mergedRecords, classifier, writers);
    for (const record of mergedRecords) {
        if (classifier.classify(record.assetId) === "Neighboring") {
            accumulateMonthlySummary(record, yearMonth, monthlyRevenueMap);
        }
    }
}
export async function runNeighboringExtraction(cliArgs = process.argv.slice(2)) {
    const config = resolveExtractionConfig(parseCliArgs(cliArgs));
    const classifier = new AssetClassifier();
    await classifier.initialize({
        neighboringDir: config.neighboringDir,
        publishingDir: config.publishingDir,
        cacheFile: config.cacheFile,
    });
    const groups = listMonthlyReportGroups(config.reportDir, config.yearMonth);
    if (groups.length === 0) {
        console.warn(`[Neighboring] No report files found for ${config.yearMonth} in ${config.reportDir}`);
        return;
    }
    const writers = createNeighboringWriters(config.outputDir);
    const monthlyRevenueMap = new Map();
    try {
        for (const group of groups) {
            await processDay(group, classifier, writers, monthlyRevenueMap, config.yearMonth);
        }
        writeMonthlySummary(monthlyRevenueMap, classifier, writers);
        console.log(`[Neighboring] Completed export for ${config.yearMonth} to ${config.outputDir}`);
    }
    finally {
        await closeWriters(Object.values(writers));
    }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    runNeighboringExtraction().catch((error) => {
        console.error("[Neighboring] Extraction failed.", error);
        process.exitCode = 1;
    });
}
