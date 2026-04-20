import * as fs from "fs";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { findFirstValue, parseNumber } from "./utils.js";
function scoreDecodedText(text) {
    const hangulMatches = text.match(/[가-힣]/g)?.length ?? 0;
    const asciiMatches = text.match(/[A-Za-z0-9 ,._:/()\-\[\]"']/g)?.length ?? 0;
    const replacementMatches = text.match(/�/g)?.length ?? 0;
    const mojibakeMatches = text.match(/遺|瑜|怨|녹|뿉|꽌|源|二쇱|삁|궗|臾|룞|諛|쾬|\?{2,}/g)?.length ?? 0;
    return (hangulMatches * 5) + asciiMatches - (replacementMatches * 20) - (mojibakeMatches * 10);
}
function detectEncoding(filePath) {
    const sample = fs.readFileSync(filePath).subarray(0, 8192);
    if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
        return "utf-8";
    }
    const utf8Decoded = sample.toString("utf8");
    const cp949Decoded = iconv.decode(sample, "cp949");
    return scoreDecodedText(cp949Decoded) > scoreDecodedText(utf8Decoded) ? "cp949" : "utf-8";
}
function createCsvStream(filePath, encoding, delimiter) {
    const source = fs.createReadStream(filePath);
    const input = encoding === "cp949"
        ? source.pipe(iconv.decodeStream("cp949"))
        : source;
    return input.pipe(parse({
        delimiter: delimiter ?? ",",
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
        bom: true,
    }));
}
export async function parseCsvRows(filePath, options = {}) {
    const rows = [];
    const resolvedEncoding = options.encoding === "auto" ? detectEncoding(filePath) : (options.encoding ?? "utf-8");
    for await (const row of createCsvStream(filePath, resolvedEncoding, options.delimiter)) {
        rows.push(row);
    }
    return rows;
}
export async function parseRevenueFiles(filePaths) {
    const aggregated = new Map();
    for (const filePath of filePaths) {
        console.log(`[Revenue] Parsing ${filePath}`);
        for await (const row of createCsvStream(filePath, "utf-8")) {
            const assetId = findFirstValue(row, ["asset id"]);
            if (!assetId)
                continue;
            const country = findFirstValue(row, ["country code", "country"]) || "XX";
            const adjustmentType = findFirstValue(row, ["adjustment type"]) || "None";
            const partnerRevenue = parseNumber(findFirstValue(row, ["estimated partner revenue"]), `${filePath} asset=${assetId} estimated partner revenue`);
            const subscriptionRevenue = parseNumber(findFirstValue(row, ["estimated partner red revenue", "estimated partner premium revenue"]), `${filePath} asset=${assetId} subscription revenue`);
            const key = `${assetId}|${country}|${adjustmentType}`;
            const existing = aggregated.get(key) ?? {
                assetId,
                country,
                adjustmentType,
                partnerRevenue: 0,
                subscriptionRevenue: 0,
            };
            existing.partnerRevenue += partnerRevenue;
            existing.subscriptionRevenue += subscriptionRevenue;
            aggregated.set(key, existing);
        }
    }
    return aggregated;
}
export async function parseUsageFiles(filePaths) {
    const aggregated = new Map();
    for (const filePath of filePaths) {
        console.log(`[Usage] Parsing ${filePath}`);
        for await (const row of createCsvStream(filePath, "utf-8")) {
            const assetId = findFirstValue(row, ["asset id"]);
            if (!assetId)
                continue;
            const country = findFirstValue(row, ["country code", "country"]) || "XX";
            const views = parseNumber(findFirstValue(row, ["views", "owned views"]), `${filePath} asset=${assetId} views`);
            const videoId = findFirstValue(row, ["video id"]);
            const key = `${assetId}|${country}`;
            const existing = aggregated.get(key) ?? {
                assetId,
                country,
                views: 0,
                videos: [],
            };
            existing.views += views;
            if (videoId) {
                const existingVideo = existing.videos.find((video) => video.videoId === videoId);
                if (existingVideo) {
                    existingVideo.views += views;
                }
                else {
                    existing.videos.push({ videoId, views });
                }
            }
            aggregated.set(key, existing);
        }
    }
    return aggregated;
}
export function mergeRevenueAndUsage(revenueMap, usageMap) {
    return Array.from(revenueMap.values()).map((revenueRecord) => {
        const usageKey = `${revenueRecord.assetId}|${revenueRecord.country}`;
        const usage = usageMap.get(usageKey);
        return {
            assetId: revenueRecord.assetId,
            country: revenueRecord.country,
            adjustmentType: revenueRecord.adjustmentType,
            partnerRevenue: revenueRecord.partnerRevenue,
            subscriptionRevenue: revenueRecord.subscriptionRevenue,
            views: usage?.views ?? 0,
            videos: usage?.videos ?? [],
        };
    });
}
