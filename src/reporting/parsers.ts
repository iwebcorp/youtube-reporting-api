import * as fs from "fs";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import type {
  AudioTierDetailEntry,
  CsvRow,
  PublishingFinancialEntry,
  RedSummaryEntry,
  RevenueRecord,
  UsageRecord,
  UsageVideoRecord,
} from "./types.js";
import { clean, findFirstValue, normalizeHeader, parseNumber } from "./utils.js";

function scoreDecodedText(text: string): number {
  const hangulMatches = text.match(/[가-힣]/g)?.length ?? 0;
  const asciiMatches = text.match(/[A-Za-z0-9 ,._:/()\-\[\]"']/g)?.length ?? 0;
  const replacementMatches = text.match(/�/g)?.length ?? 0;
  const mojibakeMatches =
    text.match(/遺|瑜|怨|녹|뿉|꽌|源|二쇱|삁|궗|臾|룞|諛|쾬|\?{2,}/g)?.length ?? 0;

  return (hangulMatches * 5) + asciiMatches - (replacementMatches * 20) - (mojibakeMatches * 10);
}

function detectEncoding(filePath: string): BufferEncoding | "cp949" {
  const sample = fs.readFileSync(filePath).subarray(0, 8192);
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return "utf-8";
  }

  const utf8Decoded = sample.toString("utf8");
  const cp949Decoded = iconv.decode(sample, "cp949");
  return scoreDecodedText(cp949Decoded) > scoreDecodedText(utf8Decoded) ? "cp949" : "utf-8";
}

function createCsvStream(filePath: string, encoding: BufferEncoding | "cp949", delimiter?: "," | "\t") {
  const source = fs.createReadStream(filePath);
  const input =
    encoding === "cp949"
      ? source.pipe(iconv.decodeStream("cp949"))
      : source;

  return input.pipe(
    parse({
      delimiter: delimiter ?? ",",
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    }),
  ) as AsyncIterable<CsvRow>;
}

export async function parseCsvRows(
  filePath: string,
  options: { encoding?: BufferEncoding | "cp949" | "auto"; delimiter?: "," | "\t" } = {},
): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];
  const resolvedEncoding = options.encoding === "auto" ? detectEncoding(filePath) : (options.encoding ?? "utf-8");
  for await (const row of createCsvStream(filePath, resolvedEncoding, options.delimiter)) {
    rows.push(row);
  }
  return rows;
}

export async function parseRevenueFiles(filePaths: string[]): Promise<Map<string, RevenueRecord>> {
  const aggregated = new Map<string, RevenueRecord>();

  for (const filePath of filePaths) {
    console.log(`[Revenue] Parsing ${filePath}`);
    for await (const row of createCsvStream(filePath, "utf-8")) {
      const assetId = findFirstValue(row, ["asset id"]);
      if (!assetId) continue;

      const country = findFirstValue(row, ["country code", "country"]) || "XX";
      const adjustmentType = findFirstValue(row, ["adjustment type"]) || "None";
      const partnerRevenue = parseNumber(
        findFirstValue(row, ["estimated partner revenue"]),
        `${filePath} asset=${assetId} estimated partner revenue`,
      );
      const subscriptionRevenue = parseNumber(
        findFirstValue(row, ["estimated partner red revenue", "estimated partner premium revenue"]),
        `${filePath} asset=${assetId} subscription revenue`,
      );

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

export async function parseUsageFiles(filePaths: string[]): Promise<Map<string, UsageRecord>> {
  const aggregated = new Map<string, UsageRecord>();

  for (const filePath of filePaths) {
    console.log(`[Usage] Parsing ${filePath}`);
    for await (const row of createCsvStream(filePath, "utf-8")) {
      const assetId = findFirstValue(row, ["asset id"]);
      if (!assetId) continue;

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
        } else {
          existing.videos.push({ videoId, views });
        }
      }

      aggregated.set(key, existing);
    }
  }

  return aggregated;
}

function mapPlaybackLocationToBucket(playbackLocationType: string): "watchPage" | "embedded" | "channelPage" | null {
  const normalized = playbackLocationType.trim().toUpperCase();
  if (normalized === "0" || normalized === "WATCH" || normalized === "WATCH_PAGE") {
    return "watchPage";
  }
  if (normalized === "1" || normalized === "EMBEDDED") {
    return "embedded";
  }
  if (normalized === "2" || normalized === "CHANNEL" || normalized === "CHANNEL_PAGE") {
    return "channelPage";
  }
  return null;
}

export async function buildPublishingUsageCacheFromReports(filePaths: string[]) {
  const aggregated = new Map<
    string,
    {
      totalViews: number;
      watchPageViews: number;
      embeddedViews: number;
      channelPageViews: number;
      liveViews: number;
      onDemandViews: number;
      adEnabledViews: number;
    }
  >();

  for (const filePath of filePaths) {
    console.log(`[PublishingUsage] Parsing ${filePath}`);
    const rows = fs.createReadStream(filePath).pipe(
      parse({
        delimiter: ",",
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
        bom: true,
      }),
    ) as AsyncIterable<string[]>;
    let columnIndexes:
      | {
          assetId: number;
          country: number;
          views: number;
          redViews: number;
          playbackLocationType: number;
          liveOrOnDemand: number;
        }
      | undefined;

    for await (const values of rows) {
      if (!columnIndexes) {
        const normalizedHeaders = values.map(normalizeHeader);
        const findColumnIndex = (aliases: string[]) => {
          const normalizedAliases = aliases.map(normalizeHeader);
          return normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));
        };
        const resolvedIndexes = {
          assetId: findColumnIndex(["asset id"]),
          country: findColumnIndex(["country code", "country"]),
          views: findColumnIndex(["views"]),
          redViews: findColumnIndex(["red views"]),
          playbackLocationType: findColumnIndex(["playback location type"]),
          liveOrOnDemand: findColumnIndex(["live or on demand"]),
        };
        const missingColumns = Object.entries(resolvedIndexes)
          .filter(([, index]) => index < 0)
          .map(([name]) => name);
        if (missingColumns.length > 0) {
          throw new Error(`[PublishingUsage] Missing required columns in ${filePath}: ${missingColumns.join(", ")}`);
        }
        columnIndexes = resolvedIndexes;
        continue;
      }

      const assetId = clean(values[columnIndexes.assetId]);
      if (!assetId) continue;
      const country = clean(values[columnIndexes.country]) || "XX";
      const key = `${assetId}|${country}`;

      const entry = aggregated.get(key) ?? {
        totalViews: 0,
        watchPageViews: 0,
        embeddedViews: 0,
        channelPageViews: 0,
        liveViews: 0,
        onDemandViews: 0,
        adEnabledViews: 0,
      };

      const views = parseNumber(clean(values[columnIndexes.views]), `${filePath} asset=${assetId} views`);
      const redViews = parseNumber(clean(values[columnIndexes.redViews]), `${filePath} asset=${assetId} red views`);
      const playbackBucket = mapPlaybackLocationToBucket(clean(values[columnIndexes.playbackLocationType]));
      const liveOrOnDemand = clean(values[columnIndexes.liveOrOnDemand]).trim().toUpperCase();

      entry.totalViews += views;
      entry.adEnabledViews += Math.max(0, views - redViews);
      if (playbackBucket === "watchPage") entry.watchPageViews += views;
      if (playbackBucket === "embedded") entry.embeddedViews += views;
      if (playbackBucket === "channelPage") entry.channelPageViews += views;
      if (liveOrOnDemand === "LIVE") entry.liveViews += views;
      if (liveOrOnDemand === "ON_DEMAND") entry.onDemandViews += views;

      aggregated.set(key, entry);
    }

    if (!columnIndexes) {
      throw new Error(`[PublishingUsage] Missing required header row in ${filePath}`);
    }
  }

  return aggregated;
}

export async function parsePublishingFinancialFiles(filePaths: string[]): Promise<Map<string, PublishingFinancialEntry>> {
  const aggregated = new Map<string, PublishingFinancialEntry>();

  for (const filePath of filePaths) {
    console.log(`[PublishingFinancial] Parsing ${filePath}`);
    for await (const row of createCsvStream(filePath, "utf-8")) {
      const assetId = findFirstValue(row, ["asset id"]);
      if (!assetId) continue;

      const country = findFirstValue(row, ["country", "country code"]) || "XX";
      const key = `${assetId}|${country}`;
      const entry = aggregated.get(key) ?? {
        assetId,
        country,
        sourceTitle: findFirstValue(row, ["asset title", "title"]),
        sourceCustomId: findFirstValue(row, ["custom id"]),
        sourceIsrc: findFirstValue(row, ["isrc"]),
        sourceAssetType: findFirstValue(row, ["asset type"]),
        ownedViews: 0,
        adsenseRevenue: 0,
        doubleclickServedYouTubeSoldRevenue: 0,
        doubleclickServedPartnerSoldRevenue: 0,
        partnerServedPartnerSoldRevenue: 0,
        totalRevenue: 0,
        partnerAdsenseRevenue: 0,
        partnerDoubleclickServedYouTubeSoldRevenue: 0,
        partnerDoubleclickServedPartnerSoldRevenue: 0,
        partnerPartnerServedPartnerSoldRevenue: 0,
        partnerTotalRevenue: 0,
      };

      entry.ownedViews += parseNumber(findFirstValue(row, ["owned views"]), `${filePath} asset=${assetId} owned views`);
      entry.adsenseRevenue += parseNumber(
        findFirstValue(row, ["youtube revenue split auction"]),
        `${filePath} asset=${assetId} youtube revenue split auction`,
      );
      entry.doubleclickServedYouTubeSoldRevenue += parseNumber(
        findFirstValue(row, ["youtube revenue split reserved"]),
        `${filePath} asset=${assetId} youtube revenue split reserved`,
      );
      entry.doubleclickServedPartnerSoldRevenue += parseNumber(
        findFirstValue(row, ["youtube revenue split partner sold youtube served"]),
        `${filePath} asset=${assetId} youtube revenue split partner sold youtube served`,
      );
      entry.partnerServedPartnerSoldRevenue += parseNumber(
        findFirstValue(row, ["youtube revenue split partner sold partner served"]),
        `${filePath} asset=${assetId} youtube revenue split partner sold partner served`,
      );
      entry.totalRevenue += parseNumber(
        findFirstValue(row, ["youtube revenue split"]),
        `${filePath} asset=${assetId} youtube revenue split`,
      );
      entry.partnerAdsenseRevenue += parseNumber(
        findFirstValue(row, ["partner revenue auction"]),
        `${filePath} asset=${assetId} partner revenue auction`,
      );
      entry.partnerDoubleclickServedYouTubeSoldRevenue += parseNumber(
        findFirstValue(row, ["partner revenue reserved"]),
        `${filePath} asset=${assetId} partner revenue reserved`,
      );
      entry.partnerDoubleclickServedPartnerSoldRevenue += parseNumber(
        findFirstValue(row, ["partner revenue partner sold youtube served"]),
        `${filePath} asset=${assetId} partner revenue partner sold youtube served`,
      );
      entry.partnerPartnerServedPartnerSoldRevenue += parseNumber(
        findFirstValue(row, ["partner revenue partner sold partner served"]),
        `${filePath} asset=${assetId} partner revenue partner sold partner served`,
      );
      entry.partnerTotalRevenue += parseNumber(
        findFirstValue(row, ["partner revenue"]),
        `${filePath} asset=${assetId} partner revenue`,
      );

      aggregated.set(key, entry);
    }
  }

  return aggregated;
}

export async function parseRedSummaryFiles(filePaths: string[]): Promise<Map<string, RedSummaryEntry>> {
  const aggregated = new Map<string, RedSummaryEntry>();

  for (const filePath of filePaths) {
    console.log(`[RedSummary] Parsing ${filePath}`);
    for await (const row of createCsvStream(filePath, "utf-8")) {
      const assetId = findFirstValue(row, ["asset id"]);
      if (!assetId) continue;

      const country = findFirstValue(row, ["country", "country code"]) || "XX";
      const adjustmentType = findFirstValue(row, ["adjustment type"]) || "None";
      const key = `${assetId}|${country}|${adjustmentType}`;
      const entry = aggregated.get(key) ?? {
        assetId,
        country,
        adjustmentType,
        sourceTitle: findFirstValue(row, ["asset title", "title"]),
        sourceAssetType: findFirstValue(row, ["asset type"]),
        sourceCustomId: findFirstValue(row, ["custom id"]),
        sourceIsrc: findFirstValue(row, ["isrc"]),
        sourceUpc: findFirstValue(row, ["upc"]),
        sourceGrid: findFirstValue(row, ["grid"]),
        sourceArtist: findFirstValue(row, ["artist"]),
        sourceAlbum: findFirstValue(row, ["album"]),
        sourceLabel: findFirstValue(row, ["label"]),
        ownedViews: 0,
        monetizedViewsAudio: 0,
        monetizedViewsAudioVisual: 0,
        monetizedViews: 0,
        youtubeRevenueSplit: 0,
        partnerRevenueProRataAudio: 0,
        partnerRevenueProRataAudioVisual: 0,
        partnerRevenueProRata: 0,
        partnerRevenuePerSubMin: 0,
        partnerRevenue: 0,
        offer: findFirstValue(row, ["offer"]),
        contentType: findFirstValue(row, ["content type"]),
        claimType: findFirstValue(row, ["claim type"]),
      };

      entry.ownedViews += parseNumber(findFirstValue(row, ["owned views"]), `${filePath} asset=${assetId} owned views`);
      entry.monetizedViewsAudio += parseNumber(
        findFirstValue(row, ["monetized views audio"]),
        `${filePath} asset=${assetId} monetized views audio`,
      );
      entry.monetizedViewsAudioVisual += parseNumber(
        findFirstValue(row, ["monetized views audio visual"]),
        `${filePath} asset=${assetId} monetized views audio visual`,
      );
      entry.monetizedViews += parseNumber(
        findFirstValue(row, ["monetized views"]),
        `${filePath} asset=${assetId} monetized views`,
      );
      entry.youtubeRevenueSplit += parseNumber(
        findFirstValue(row, ["youtube revenue split"]),
        `${filePath} asset=${assetId} youtube revenue split`,
      );
      entry.partnerRevenueProRataAudio += parseNumber(
        findFirstValue(row, ["partner revenue pro rata audio"]),
        `${filePath} asset=${assetId} partner revenue pro rata audio`,
      );
      entry.partnerRevenueProRataAudioVisual += parseNumber(
        findFirstValue(row, ["partner revenue pro rata audio visual"]),
        `${filePath} asset=${assetId} partner revenue pro rata audio visual`,
      );
      entry.partnerRevenueProRata += parseNumber(
        findFirstValue(row, ["partner revenue pro rata"]),
        `${filePath} asset=${assetId} partner revenue pro rata`,
      );
      entry.partnerRevenuePerSubMin += parseNumber(
        findFirstValue(row, ["partner revenue per sub min"]),
        `${filePath} asset=${assetId} partner revenue per sub min`,
      );
      entry.partnerRevenue += parseNumber(
        findFirstValue(row, ["partner revenue usd", "partner revenue"]),
        `${filePath} asset=${assetId} partner revenue`,
      );

      aggregated.set(key, entry);
    }
  }

  return aggregated;
}

export async function parseAudioTierDetailFiles(filePaths: string[]): Promise<AudioTierDetailEntry[]> {
  const rows: AudioTierDetailEntry[] = [];

  for (const filePath of filePaths) {
    console.log(`[AudioTier] Parsing ${filePath}`);
    for await (const row of createCsvStream(filePath, "utf-8")) {
      const assetId = findFirstValue(row, ["asset id"]);
      if (!assetId) continue;

      rows.push({
        assetId,
        country: findFirstValue(row, ["country", "country code"]) || "XX",
        date: findFirstValue(row, ["date", "day"]),
        videoId: findFirstValue(row, ["video id"]),
        title: findFirstValue(row, ["asset title", "title"]),
        customId: findFirstValue(row, ["custom id"]),
        isrc: findFirstValue(row, ["isrc"]),
        upc: findFirstValue(row, ["upc"]),
        grid: findFirstValue(row, ["grid"]),
        artist: findFirstValue(row, ["artist"]),
        album: findFirstValue(row, ["album"]),
        label: findFirstValue(row, ["label"]),
        ownedViews: parseNumber(findFirstValue(row, ["owned views"]), `${filePath} asset=${assetId} owned views`),
        youtubeRevenueSplit: parseNumber(
          findFirstValue(row, ["youtube revenue split"]),
          `${filePath} asset=${assetId} youtube revenue split`,
        ),
        partnerRevenueProRata: parseNumber(
          findFirstValue(row, ["partner revenue pro rata"]),
          `${filePath} asset=${assetId} partner revenue pro rata`,
        ),
        partnerRevenuePerPlayMin: parseNumber(
          findFirstValue(row, ["partner revenue per play min"]),
          `${filePath} asset=${assetId} partner revenue per play min`,
        ),
        partnerRevenue: parseNumber(
          findFirstValue(row, ["partner revenue"]),
          `${filePath} asset=${assetId} partner revenue`,
        ),
      });
    }
  }

  return rows;
}

export function mergeRevenueAndUsage(
  revenueMap: Map<string, RevenueRecord>,
  usageMap: Map<string, UsageRecord>,
) {
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
      videos: usage?.videos ?? ([] as UsageVideoRecord[]),
    };
  });
}
