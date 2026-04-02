import * as fs from "fs";
import * as path from "path";

interface VideoMeta {
  title: string;
  channelTitle: string;
}

interface ChannelData {
  name: string;
  revenue: number;
}

interface VideoData {
  title: string;
  revenue: number;
}

async function analyzeReports() {
  const reportDir = path.join(process.cwd(), "reports");
  const cacheFile = path.join(process.cwd(), "video_metadata_cache.json");
  const channelCacheFile = path.join(process.cwd(), "channel_metadata_cache.json");

  if (!fs.existsSync(reportDir)) {
    console.error("No reports directory found. Run 'npm run get-reports' first.");
    return;
  }

  // Load Video Metadata Cache
  const metadata: Record<string, VideoMeta> = {};
  if (fs.existsSync(cacheFile)) {
    const raw = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Record<string, VideoMeta>;
    Object.assign(metadata, raw);
    console.log(`Loaded metadata for ${Object.keys(metadata).length} videos.`);
  }

  // Load Channel Name Cache
  const channelNames: Record<string, string> = {};
  if (fs.existsSync(channelCacheFile)) {
    const raw = JSON.parse(fs.readFileSync(channelCacheFile, "utf-8")) as Record<string, string>;
    Object.assign(channelNames, raw);
    console.log(`Loaded names for ${Object.keys(channelNames).length} channels.`);
  }

  const files = fs.readdirSync(reportDir).filter(f => f.endsWith(".csv"));
  if (files.length === 0) {
    console.log("No CSV files found in reports directory.");
    return;
  }

  console.log(`\nAnalyzing ${files.length} report files...\n`);

  const dailyRevenue: Record<string, number> = {};
  const channelRevenue: Record<string, ChannelData> = {};
  const videoRevenue: Record<string, VideoData> = {};

  for (const file of files) {
    const filePath = path.join(reportDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const rawLine of lines.slice(1)) {
      const line = rawLine.trim();
      if (!line) continue;

      const columns = line.split(",");
      if (columns.length < 8) continue;

      const date = columns[0] ?? "";
      const channel_id = columns[1] ?? "";
      const video_id = columns[2] ?? "";
      const revenue_str = columns[7] ?? "";

      if (!date || !channel_id || !revenue_str) continue;

      const revenue = parseFloat(revenue_str);
      if (isNaN(revenue)) continue;

      // Daily
      dailyRevenue[date] = (dailyRevenue[date] ?? 0) + revenue;

      // Channel (use channelNames cache first, then video meta, then raw ID)
      const channelName = channelNames[channel_id] ?? (video_id ? metadata[video_id]?.channelTitle : undefined) ?? channel_id;

      if (!channelRevenue[channel_id]) {
        channelRevenue[channel_id] = { name: channelName, revenue: 0 };
      }
      (channelRevenue[channel_id] as ChannelData).revenue += revenue;

      // Video
      if (video_id) {
        const videoTitle = metadata[video_id]?.title ?? `ID: ${video_id}`;
        if (!videoRevenue[video_id]) {
          videoRevenue[video_id] = { title: videoTitle, revenue: 0 };
        }
        (videoRevenue[video_id] as VideoData).revenue += revenue;
      }
    }
  }

  // --- Print Summaries ---
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📅 Daily Revenue (최근 7일)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const sortedDates = Object.keys(dailyRevenue).sort().reverse();
  for (const date of sortedDates.slice(0, 7)) {
    const rev = dailyRevenue[date] ?? 0;
    const d = date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8);
    console.log(`  ${d}: $${rev.toFixed(2)}`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📺 Top 10 채널 (수익 기준)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const sortedChannels = Object.entries(channelRevenue).sort((a, b) => b[1].revenue - a[1].revenue);
  for (let i = 0; i < Math.min(10, sortedChannels.length); i++) {
    const [id, data] = sortedChannels[i]!;
    console.log(`  ${i + 1}. ${data.name}`);
    console.log(`     채널 ID: ${id} | 수익: $${data.revenue.toFixed(2)}`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎬 Top 20 동영상 (수익 기준)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const sortedVideos = Object.entries(videoRevenue).sort((a, b) => b[1].revenue - a[1].revenue);
  for (let i = 0; i < Math.min(20, sortedVideos.length); i++) {
    const [id, data] = sortedVideos[i]!;
    console.log(`  ${i + 1}. ${data.title}`);
    console.log(`     영상 ID: ${id} | 수익: $${data.revenue.toFixed(2)}`);
  }

  const totalRev = Object.values(dailyRevenue).reduce((acc, curr) => acc + curr, 0);
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`💰 Grand Total: $${totalRev.toFixed(2)}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // CSV 추출
  let csvContent = "\uFEFF"; // 한글 깨짐 방지용 UTF-8 BOM
  csvContent += "=== 일별 수익 (전체 기간) ===\n날짜,수익\n";
  for (const date of sortedDates) {
    const rev = dailyRevenue[date] ?? 0;
    const d = date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8);
    csvContent += `${d},${rev.toFixed(2)}\n`;
  }

  csvContent += "\n=== 채널별 현황 ===\n순위,채널명,채널ID,수익\n";
  for (let i = 0; i < sortedChannels.length; i++) {
    const [id, data] = sortedChannels[i]!;
    const safeName = data.name.replace(/"/g, '""');
    csvContent += `${i + 1},"${safeName}",${id},${data.revenue.toFixed(2)}\n`;
  }

  csvContent += "\n=== 비디오별 현황 ===\n순위,비디오명,비디오ID,수익\n";
  for (let i = 0; i < Math.min(100, sortedVideos.length); i++) {
    const [id, data] = sortedVideos[i]!;
    const safeTitle = data.title.replace(/"/g, '""');
    csvContent += `${i + 1},"${safeTitle}",${id},${data.revenue.toFixed(2)}\n`;
  }

  const exportPath = path.join(process.cwd(), "analysis_result.csv");
  fs.writeFileSync(exportPath, csvContent, "utf-8");
  console.log(`\n✅ 종합 분석 결과가 엑셀 호환 CSV 파일로 저장되었습니다: ${exportPath}`);
}

analyzeReports().catch(console.error);

