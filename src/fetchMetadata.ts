import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import * as fs from "fs";
import * as path from "path";

interface VideoMeta {
  title: string;
  channelTitle: string;
}

async function fetchTopVideoMetadata() {
  const auth = await getAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  const reportDir = path.join(process.cwd(), "reports");
  const cacheFile = path.join(process.cwd(), "video_metadata_cache.json");

  // Load existing cache
  let metadata: Record<string, VideoMeta> = {};
  if (fs.existsSync(cacheFile)) {
    metadata = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    console.log(`Existing cache: ${Object.keys(metadata).length} videos`);
  }

  // Accumulate revenue per video_id
  const videoRevenue: Record<string, number> = {};
  const files = fs.readdirSync(reportDir).filter(f => f.endsWith(".csv"));

  console.log("Calculating top videos by revenue...");
  for (const file of files) {
    const content = fs.readFileSync(path.join(reportDir, file), "utf-8");
    const lines = content.split("\n").slice(1);
    for (const rawLine of lines) {
      const cols = rawLine.trim().split(",");
      if (cols.length < 8) continue;
      const video_id = cols[2] ?? "";
      const revenue_str = cols[7] ?? "";
      if (!video_id || !revenue_str) continue;
      const rev = parseFloat(revenue_str);
      if (!isNaN(rev)) {
        videoRevenue[video_id] = (videoRevenue[video_id] ?? 0) + rev;
      }
    }
  }

  // Sort by revenue, take top 500 not yet in cache
  const topVideos = Object.entries(videoRevenue)
    .sort((a, b) => b[1] - a[1])
    .filter(([id]) => !metadata[id])
    .slice(0, 500)
    .map(([id]) => id);

  console.log(`Fetching metadata for ${topVideos.length} top videos not yet cached...`);

  const batchSize = 50;
  for (let i = 0; i < topVideos.length; i += batchSize) {
    const batch = topVideos.slice(i, i + batchSize);
    try {
      const res = await youtube.videos.list({
        part: ["snippet"],
        id: batch,
      });
      if (res.data.items) {
        for (const item of res.data.items) {
          if (item.id) {
            metadata[item.id] = {
              title: item.snippet?.title ?? "Unknown",
              channelTitle: item.snippet?.channelTitle ?? "Unknown",
            };
          }
        }
      }
      console.log(`Fetched ${Math.min(i + batchSize, topVideos.length)} / ${topVideos.length}`);
    } catch (err: any) {
      console.error("Error fetching batch:", err.message);
      break;
    }
  }

  // Also fetch channel names for top channels
  const channelRevenue: Record<string, number> = {};
  for (const file of files) {
    const content = fs.readFileSync(path.join(reportDir, file), "utf-8");
    const lines = content.split("\n").slice(1);
    for (const rawLine of lines) {
      const cols = rawLine.trim().split(",");
      if (cols.length < 8) continue;
      const channel_id = cols[1] ?? "";
      const revenue_str = cols[7] ?? "";
      if (!channel_id || !revenue_str) continue;
      const rev = parseFloat(revenue_str);
      if (!isNaN(rev)) {
        channelRevenue[channel_id] = (channelRevenue[channel_id] ?? 0) + rev;
      }
    }
  }

  const topChannels = Object.entries(channelRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id]) => id);

  const channelCache: Record<string, string> = {};
  const existingChannelCache = path.join(process.cwd(), "channel_metadata_cache.json");
  if (fs.existsSync(existingChannelCache)) {
    Object.assign(channelCache, JSON.parse(fs.readFileSync(existingChannelCache, "utf-8")));
  }
  const unknownChannels = topChannels.filter(id => !channelCache[id]);

  if (unknownChannels.length > 0) {
    console.log(`Fetching names for ${unknownChannels.length} channels...`);
    for (let i = 0; i < unknownChannels.length; i += 50) {
      const batch = unknownChannels.slice(i, i + 50);
      try {
        const res = await youtube.channels.list({ part: ["snippet"], id: batch });
        if (res.data.items) {
          for (const item of res.data.items) {
            if (item.id) {
              channelCache[item.id] = item.snippet?.title ?? item.id;
            }
          }
        }
      } catch (err: any) {
        console.error("Error fetching channels:", err.message);
      }
    }
    fs.writeFileSync(existingChannelCache, JSON.stringify(channelCache, null, 2));
    console.log("Channel cache saved to channel_metadata_cache.json");
  }

  fs.writeFileSync(cacheFile, JSON.stringify(metadata, null, 2));
  console.log(`\n✅ Metadata cache updated: ${Object.keys(metadata).length} videos total`);
  console.log("Run 'npm run analyze-reports' to see results with titles!");
  
  // API 라이브러리의 백그라운드 네트워크 연결 잔재로 프로세스가 대기하는 현상을 방지합니다.
  process.exit(0);
}

fetchTopVideoMetadata().catch(err => {
  console.error(err);
  process.exit(1);
});
