import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import iconv from "iconv-lite";
import { AssetClassifier } from "./assetClassifier.js";
import { parseCsvRows } from "./reporting/parsers.js";
import { csvEscape, ensureDirectory, normalizeCustomId, parseCliArgs, parseNumber, resolveExtractionConfig } from "./reporting/utils.js";

interface AggregatedShortsRow {
  assetId: string;
  country: string;
  views: number;
  engagedViews: number;
  watchTimeMinutes: number;
  redViews: number;
  redWatchTimeMinutes: number;
  videoIds: Set<string>;
}

interface AggregatedShortsVideoRow {
  assetId: string;
  country: string;
  videoId: string;
  views: number;
  engagedViews: number;
  watchTimeMinutes: number;
  redViews: number;
  redWatchTimeMinutes: number;
}

function listMonthlyCombinedReports(reportDir: string, yearMonth: string): string[] {
  if (!fs.existsSync(reportDir)) {
    return [];
  }

  return fs
    .readdirSync(reportDir)
    .filter((fileName) => fileName.endsWith("_content_owner_asset_combined_a3.csv"))
    .filter((fileName) => fileName.startsWith(`report_${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-`))
    .map((fileName) => path.join(reportDir, fileName))
    .sort((left, right) => left.localeCompare(right));
}

async function run(cliArgs: string[] = process.argv.slice(2)): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const classifier = new AssetClassifier();
  await classifier.initialize({
    yearMonth: config.yearMonth,
    neighboringDir: config.neighboringDir,
    publishingDir: config.publishingDir,
  });

  const combinedFiles = listMonthlyCombinedReports(config.reportDir, config.yearMonth);
  if (combinedFiles.length === 0) {
    console.warn(`[Shorts] No combined reports found for ${config.yearMonth} in ${config.reportDir}`);
    return;
  }

  const aggregated = new Map<string, AggregatedShortsRow>();
  const videoAggregated = new Map<string, AggregatedShortsVideoRow>();
  let rowsWithoutVideoId = 0;
  for (const filePath of combinedFiles) {
    console.log(`[Shorts] Parsing ${filePath}`);
    const rows = await parseCsvRows(filePath);
    for (const row of rows) {
      const assetId = row.asset_id?.trim() ?? "";
      if (!assetId) continue;

      if ((row.playback_location_type?.trim() ?? "") !== "10") {
        continue;
      }

      const country = row.country_code?.trim() || "XX";
      const key = `${assetId}|${country}`;
      const entry = aggregated.get(key) ?? {
        assetId,
        country,
        views: 0,
        engagedViews: 0,
        watchTimeMinutes: 0,
        redViews: 0,
        redWatchTimeMinutes: 0,
        videoIds: new Set<string>(),
      };

      entry.views += parseNumber(row.views ?? "", `${filePath} asset=${assetId} views`);
      entry.engagedViews += parseNumber(row.engaged_views ?? "", `${filePath} asset=${assetId} engaged_views`);
      entry.watchTimeMinutes += parseNumber(row.watch_time_minutes ?? "", `${filePath} asset=${assetId} watch_time_minutes`);
      entry.redViews += parseNumber(row.red_views ?? "", `${filePath} asset=${assetId} red_views`);
      entry.redWatchTimeMinutes += parseNumber(
        row.red_watch_time_minutes ?? "",
        `${filePath} asset=${assetId} red_watch_time_minutes`,
      );

      const videoId = row.video_id?.trim() ?? "";
      if (videoId) {
        entry.videoIds.add(videoId);
        const videoKey = `${assetId}|${country}|${videoId}`;
        const videoEntry = videoAggregated.get(videoKey) ?? {
          assetId,
          country,
          videoId,
          views: 0,
          engagedViews: 0,
          watchTimeMinutes: 0,
          redViews: 0,
          redWatchTimeMinutes: 0,
        };
        videoEntry.views += parseNumber(row.views ?? "", `${filePath} asset=${assetId} video=${videoId} views`);
        videoEntry.engagedViews += parseNumber(
          row.engaged_views ?? "",
          `${filePath} asset=${assetId} video=${videoId} engaged_views`,
        );
        videoEntry.watchTimeMinutes += parseNumber(
          row.watch_time_minutes ?? "",
          `${filePath} asset=${assetId} video=${videoId} watch_time_minutes`,
        );
        videoEntry.redViews += parseNumber(
          row.red_views ?? "",
          `${filePath} asset=${assetId} video=${videoId} red_views`,
        );
        videoEntry.redWatchTimeMinutes += parseNumber(
          row.red_watch_time_minutes ?? "",
          `${filePath} asset=${assetId} video=${videoId} red_watch_time_minutes`,
        );
        videoAggregated.set(videoKey, videoEntry);
      } else {
        rowsWithoutVideoId += 1;
      }

      aggregated.set(key, entry);
    }
  }

  const rows = Array.from(aggregated.values()).sort((left, right) => {
    if (left.country !== right.country) {
      return left.country.localeCompare(right.country);
    }
    return right.views - left.views;
  });

  ensureDirectory(config.outputDir);
  const outputPath = path.join(config.outputDir, `shorts_song_data_${config.yearMonth}.csv`);
  const header = [
    "Month",
    "Category",
    "Country",
    "Asset ID",
    "Asset Title",
    "Custom ID",
    "ISRC",
    "ISWC",
    "Writers",
    "Shorts Views",
    "Engaged Views",
    "Watch Time Minutes",
    "Red Views",
    "Red Watch Time Minutes",
    "Distinct Video Count",
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    const metadata = classifier.getMetadata(row.assetId);
    const category = classifier.classify(row.assetId);
    lines.push(
      [
        config.yearMonth,
        csvEscape(category),
        csvEscape(row.country),
        csvEscape(row.assetId),
        csvEscape(metadata.title),
        csvEscape(normalizeCustomId(metadata.customId)),
        csvEscape(metadata.isrc),
        csvEscape(metadata.iswc),
        csvEscape(metadata.writers),
        row.views.toString(),
        row.engagedViews.toString(),
        row.watchTimeMinutes.toFixed(6),
        row.redViews.toString(),
        row.redWatchTimeMinutes.toFixed(6),
        row.videoIds.size.toString(),
      ].join(","),
    );
  }

  fs.writeFileSync(outputPath, iconv.encode(`${lines.join("\n")}\n`, "cp949"));
  console.log(`[Shorts] Wrote ${outputPath}. rows=${rows.length} files=${combinedFiles.length}`);

  const videoRows = Array.from(videoAggregated.values()).sort((left, right) => {
    if (left.country !== right.country) return left.country.localeCompare(right.country);
    if (left.assetId !== right.assetId) return left.assetId.localeCompare(right.assetId);
    return right.engagedViews - left.engagedViews || left.videoId.localeCompare(right.videoId);
  });
  const videoOutputPath = path.join(config.outputDir, `shorts_video_usage_detail_${config.yearMonth}.csv`);
  const videoHeader = [
    "Month",
    "Category",
    "Country",
    "Asset ID",
    "Asset Title",
    "Custom ID",
    "ISRC",
    "ISWC",
    "Writers",
    "Video ID",
    "Shorts Views",
    "Engaged Views",
    "Watch Time Minutes",
    "Red Views",
    "Red Watch Time Minutes",
  ];
  const videoLines = [videoHeader.join(",")];
  for (const row of videoRows) {
    const metadata = classifier.getMetadata(row.assetId);
    const category = classifier.classify(row.assetId);
    videoLines.push(
      [
        config.yearMonth,
        csvEscape(category),
        csvEscape(row.country),
        csvEscape(row.assetId),
        csvEscape(metadata.title),
        csvEscape(normalizeCustomId(metadata.customId)),
        csvEscape(metadata.isrc),
        csvEscape(metadata.iswc),
        csvEscape(metadata.writers),
        csvEscape(row.videoId),
        row.views.toString(),
        row.engagedViews.toString(),
        row.watchTimeMinutes.toFixed(6),
        row.redViews.toString(),
        row.redWatchTimeMinutes.toFixed(6),
      ].join(","),
    );
  }
  fs.writeFileSync(videoOutputPath, iconv.encode(`${videoLines.join("\n")}\n`, "cp949"));
  console.log(
    `[Shorts] Wrote ${videoOutputPath}. rows=${videoRows.length} rowsWithoutVideoId=${rowsWithoutVideoId}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error("[Shorts] Extraction failed.", error);
    process.exitCode = 1;
  });
}
