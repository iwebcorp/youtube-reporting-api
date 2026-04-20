import { pathToFileURL } from "url";
import { AssetClassifier } from "./assetClassifier.js";
import { mergeRevenueAndUsage, parseRevenueFiles, parseUsageFiles } from "./reporting/parsers.js";
import { createPublishingWriters, closeWriters } from "./reporting/writers.js";
import { csvEscape, listMonthlyReportGroups, loadPublishingUsageCache, parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
function isPublishingRecord(classifier, assetId) {
    const metadata = classifier.getMetadata(assetId);
    if (classifier.classify(assetId) === "Publishing") {
        return true;
    }
    if (!metadata.isrc && (metadata.writers !== "Unidentified Writers" || metadata.artist !== "Various Artists")) {
        return true;
    }
    return false;
}
function buildMonthlyKey(assetId, country, month) {
    return `${assetId}|${country}|${month}`;
}
function accumulateMonthlySummary(record, month, monthlyRevenueMap) {
    if (record.subscriptionRevenue <= 0 && record.adjustmentType !== "None") {
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
    if (record.adjustmentType === "None") {
        existing.views += record.views;
    }
    monthlyRevenueMap.set(key, existing);
}
function accumulateMonthlyAdSummary(record, month, monthlyAdMap, publishingUsageCache) {
    if (record.adjustmentType !== "None") {
        return;
    }
    const key = buildMonthlyKey(record.assetId, record.country, month);
    const existing = monthlyAdMap.get(key) ?? {
        assetId: record.assetId,
        country: record.country,
        adRevenue: 0,
        views: 0,
        watchPageViews: 0,
        embeddedViews: 0,
        channelPageViews: 0,
        liveViews: 0,
        onDemandViews: 0,
        adEnabledViews: 0,
    };
    existing.adRevenue += Math.max(0, record.partnerRevenue - record.subscriptionRevenue);
    const cached = publishingUsageCache[record.assetId];
    existing.views += record.views;
    existing.watchPageViews += cached?.watchPageViews ?? 0;
    existing.embeddedViews += cached?.embeddedViews ?? 0;
    existing.channelPageViews += cached?.channelPageViews ?? 0;
    existing.liveViews += cached?.liveViews ?? 0;
    existing.onDemandViews += cached?.onDemandViews ?? record.views;
    existing.adEnabledViews += cached?.totalViews ?? record.views;
    monthlyAdMap.set(key, existing);
}
function writeAdjustmentReport(dateKey, records, classifier, writers) {
    for (const record of records) {
        if (!isPublishingRecord(classifier, record.assetId)) {
            continue;
        }
        if (record.adjustmentType === "None") {
            continue;
        }
        const metadata = classifier.getMetadata(record.assetId);
        const adRevenue = Math.max(0, record.partnerRevenue - record.subscriptionRevenue);
        if (adRevenue <= 0 && record.subscriptionRevenue <= 0 && record.views <= 0) {
            continue;
        }
        const adjustmentRow = [
            record.adjustmentType,
            dateKey,
            record.country,
            record.assetId,
            csvEscape(metadata.title),
            "",
            "",
            "Composition",
            metadata.customId,
            metadata.isrc,
            metadata.iswc,
            metadata.hfa,
            csvEscape(metadata.writers),
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
        writers.dailyAdAdjustment.write(`${adjustmentRow.join(",")}\n`);
    }
}
function writeMonthlyAdSummary(monthlyAdMap, classifier, writers, publishingUsageCache) {
    for (const summary of monthlyAdMap.values()) {
        const metadata = classifier.getMetadata(summary.assetId);
        const usage = publishingUsageCache[summary.assetId];
        const totalViews = summary.views > 0 ? summary.views : (usage?.totalViews ?? 0);
        const watchPageViews = summary.watchPageViews > 0 ? summary.watchPageViews : (usage?.watchPageViews ?? 0);
        const embeddedViews = summary.embeddedViews > 0 ? summary.embeddedViews : (usage?.embeddedViews ?? 0);
        const channelPageViews = summary.channelPageViews > 0 ? summary.channelPageViews : (usage?.channelPageViews ?? 0);
        const liveViews = summary.liveViews > 0 ? summary.liveViews : (usage?.liveViews ?? 0);
        const onDemandViews = summary.onDemandViews > 0 ? summary.onDemandViews : (usage?.onDemandViews ?? totalViews);
        const adEnabledViews = summary.adEnabledViews > 0 ? summary.adEnabledViews : totalViews;
        const adRevenue = summary.adRevenue.toFixed(6);
        const adsenseRevenue = (usage?.adsenseRevenue ?? 0).toFixed(6);
        const doubleclickServedYouTubeSoldRevenue = (usage?.doubleclickServedYouTubeSoldRevenue ?? 0).toFixed(6);
        const doubleclickServedPartnerSoldRevenue = (usage?.doubleclickServedPartnerSoldRevenue ?? 0).toFixed(6);
        const partnerServedPartnerSoldRevenue = (usage?.partnerServedPartnerSoldRevenue ?? 0).toFixed(6);
        const row = [
            summary.assetId,
            "",
            metadata.customId,
            metadata.iswc,
            metadata.hfa,
            csvEscape(metadata.title),
            csvEscape(metadata.writers),
            metadata.musicClaimType,
            metadata.compositionRightType,
            "100.00",
            summary.country,
            String(totalViews),
            String(watchPageViews),
            String(embeddedViews),
            String(channelPageViews),
            String(liveViews),
            String(onDemandViews),
            String(adEnabledViews),
            adsenseRevenue,
            doubleclickServedYouTubeSoldRevenue,
            doubleclickServedPartnerSoldRevenue,
            partnerServedPartnerSoldRevenue,
            adRevenue,
            adsenseRevenue,
            doubleclickServedYouTubeSoldRevenue,
            doubleclickServedPartnerSoldRevenue,
            partnerServedPartnerSoldRevenue,
            adRevenue,
        ];
        writers.dailyAd.write(`${row.join(",")}\n`);
    }
}
function writeMonthlySummary(monthlyRevenueMap, classifier, writers) {
    for (const summary of monthlyRevenueMap.values()) {
        if (summary.revenue <= 0 && summary.views <= 0) {
            continue;
        }
        const metadata = classifier.getMetadata(summary.assetId);
        const revenue = summary.revenue.toFixed(6);
        const row = [
            "None",
            summary.month,
            summary.country,
            summary.assetId,
            csvEscape(metadata.title),
            "",
            metadata.customId,
            metadata.isrc,
            metadata.iswc,
            metadata.hfa,
            csvEscape(metadata.writers),
            metadata.compositionRightType,
            "100.00",
            "UGC",
            "Unknown",
            "YouTube Premium Individual monthly",
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
function writeDdexDsr(monthlyRevenueMap, classifier, writers, yearMonth) {
    const startDate = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-01`;
    const endDate = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-31`;
    writers.ddexDsr.write(`HEAD,dsrf/1.2/1.2/1.1,UgcProfileSRB,1.2,${yearMonth},${endDate}T23:59:59Z,1,1,${startDate},${endDate},PADPIDA,YouTube,Usage-HardwareAudioTier-Combined-All,,kwangsoomedia-pla,kwangsoomedia_pla\n`);
    writers.ddexDsr.write("#HEAD,MessageVersion,Profile,ProfileVersion,MessageId,MessageCreatedDateTime,FileNumber,NumberOfFiles,UsageStartDate,UsageEndDate,SenderPartyId,SenderName,ServiceDescription,RecipientPartyId,RecipientName,RepresentedRepertoire\n");
    writers.ddexDsr.write("#GSY09,SummaryRecordId,Territory,ServiceDescription,Usages,AllocatedUsages,AllocatedAmount,AllocatedNetRevenue,Currency,RightsType\n");
    writers.ddexDsr.write("#SR02,SummaryRecordId,DspResourceId,Title,DisplayArtistName,DisplayArtistPartyId,ISRC,DspWorkId,MusicalWorkTitle,ISWC,ComposerAuthor,ComposerAuthorPartyId,Usages,ValidityPeriodStart,ValidityPeriodEnd,ContentCategory,RightsControllerWorkID,RightShare%,RightType,AllocatedNetRevenue,AllocatedAmount\n");
    let recordIndex = 1;
    for (const summary of monthlyRevenueMap.values()) {
        if (summary.revenue <= 0 && summary.views <= 0) {
            continue;
        }
        const metadata = classifier.getMetadata(summary.assetId);
        writers.ddexDsr.write([
            "GSY09",
            `${yearMonth}-${String(recordIndex).padStart(6, "0")}`,
            summary.country,
            "Usage-HardwareAudioTier-Combined-All",
            String(summary.views),
            String(summary.views),
            summary.revenue.toFixed(6),
            summary.revenue.toFixed(6),
            "USD",
            metadata.compositionRightType || "Mechanical",
        ].join(",") + "\n");
        writers.ddexDsr.write([
            "SR02",
            `${yearMonth}-${String(recordIndex).padStart(6, "0")}`,
            summary.assetId,
            metadata.title,
            metadata.writers,
            "",
            metadata.isrc,
            metadata.customId,
            metadata.title,
            metadata.iswc,
            metadata.writers,
            "",
            String(summary.views),
            startDate,
            endDate,
            "UGC",
            metadata.customId,
            "100.00",
            metadata.compositionRightType || "Mechanical",
            summary.revenue.toFixed(6),
            summary.revenue.toFixed(6),
        ].map(csvEscape).join(",") + "\n");
        recordIndex += 1;
    }
}
async function processDay(group, classifier, writers, monthlyRevenueMap, monthlyAdMap, publishingUsageCache, yearMonth) {
    console.log(`[Publishing] Processing ${group.reportDate}. revenueFiles=${group.revenueFiles.length}, usageFiles=${group.usageFiles.length}`);
    const revenueMap = await parseRevenueFiles(group.revenueFiles);
    const usageMap = await parseUsageFiles(group.usageFiles);
    const mergedRecords = mergeRevenueAndUsage(revenueMap, usageMap);
    writeAdjustmentReport(group.dateKey, mergedRecords, classifier, writers);
    for (const record of mergedRecords) {
        if (isPublishingRecord(classifier, record.assetId)) {
            accumulateMonthlySummary(record, yearMonth, monthlyRevenueMap);
            accumulateMonthlyAdSummary(record, yearMonth, monthlyAdMap, publishingUsageCache);
        }
    }
}
export async function runPublishingExtraction(cliArgs = process.argv.slice(2)) {
    const config = resolveExtractionConfig(parseCliArgs(cliArgs));
    const classifier = new AssetClassifier();
    const publishingUsageCache = loadPublishingUsageCache();
    await classifier.initialize({
        neighboringDir: config.neighboringDir,
        publishingDir: config.publishingDir,
        cacheFile: config.cacheFile,
    });
    const groups = listMonthlyReportGroups(config.reportDir, config.yearMonth);
    if (groups.length === 0) {
        console.warn(`[Publishing] No report files found for ${config.yearMonth} in ${config.reportDir}`);
        return;
    }
    const writers = createPublishingWriters(config.outputDir);
    const monthlyRevenueMap = new Map();
    const monthlyAdMap = new Map();
    try {
        for (const group of groups) {
            await processDay(group, classifier, writers, monthlyRevenueMap, monthlyAdMap, publishingUsageCache, config.yearMonth);
        }
        writeMonthlyAdSummary(monthlyAdMap, classifier, writers, publishingUsageCache);
        writeMonthlySummary(monthlyRevenueMap, classifier, writers);
        writeDdexDsr(monthlyRevenueMap, classifier, writers, config.yearMonth);
        console.log(`[Publishing] Completed export for ${config.yearMonth} to ${config.outputDir}`);
    }
    finally {
        await closeWriters(Object.values(writers));
    }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    runPublishingExtraction().catch((error) => {
        console.error("[Publishing] Extraction failed.", error);
        process.exitCode = 1;
    });
}
