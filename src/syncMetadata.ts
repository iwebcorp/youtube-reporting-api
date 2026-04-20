import { google } from "googleapis";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const cfg = loadConfig();
const reportDir = path.join(process.cwd(), cfg.reportDir);
const cachePath = path.join(process.cwd(), "asset_metadata_cache.json");

async function fetchRealMetadata() {
  const auth = await getAuthClient();
  const youtube = google.youtube({ version: "v3", auth });

  // 1. 3월 리포트에서 자산 ID 및 배분된 비디오 ID 추출
  const allFiles = fs.readdirSync(reportDir).filter(f => f.endsWith(".csv") && (f.includes("_estimated_revenue_a1") || f.includes("_combined_a3")));
  const assetIds = new Set<string>();
  const assetToVideoIds = new Map<string, Set<string>>();

  console.log(`[Metadata-Fetcher] ${allFiles.length}개의 리포트에서 자산 및 비디오 매핑 추출 중...`);
  for (const file of allFiles) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(reportDir, file)), crlfDelay: Infinity });
    let colMap: Record<string, number> = {}, isHeader = true;
    for await (const line of rl) {
        const cols = line.split(",");
        if (isHeader) {
          cols.forEach((c, idx) => { colMap[c.toLowerCase().trim()] = idx; });
          isHeader = false; continue;
        }
        const aid = cols[colMap["asset_id"]];
        const vid = cols[colMap["video_id"]];
        if (aid) {
          assetIds.add(aid);
          if (vid) {
            if (!assetToVideoIds.has(aid)) assetToVideoIds.set(aid, new Set());
            assetToVideoIds.get(aid)!.add(vid);
          }
        }
    }
  }

  const uniqueIds = Array.from(assetIds);
  console.log(`[Metadata-Fetcher] 총 ${uniqueIds.length}개의 고유 자산 발견. 파트너 API 조회 시작...`);

  const cachePath = path.join(process.cwd(), "asset_metadata_cache.json");
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf-8")) : {};
  const batchSize = 50;

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    console.log(`[Metadata-Fetcher] 파트너 API 조회 중... (${i + batch.length} / ${uniqueIds.length})`);

    try {
      const res = await auth.request<any>({
        url: `https://www.googleapis.com/youtube/partner/v1/assets`,
        params: {
          id: batch.join(","),
          onBehalfOfContentOwner: cfg.contentOwnerId,
          fetchMetadata: true
        }
      });

      const assets = res.data.items || [];
      for (const asset of assets) {
        const meta = asset.metadata || {};
        const writers = (meta.writers || []).join(" / ");
        const artist = (meta.artist || []).join(" / ");
        const existing = cache[asset.id!] || {};
        
        const updatedMeta = {
          assetId: asset.id,
          title: meta.title || existing.title || "",
          customId: meta.customId || existing.customId || "",
          isrc: meta.isrc || existing.isrc || "",
          iswc: meta.iswc || existing.iswc || "",
          hfa: meta.hfa || existing.hfa || "",
          writers: writers || existing.writers || artist || existing.artist || "Various Artists",
          artist: artist || existing.artist || "Various Artists",
          album: meta.album || existing.album || "",
          label: meta.label || existing.label || "",
          assetType: asset.type || existing.assetType || "Sound Recording"
        };

        if (!updatedMeta.artist || updatedMeta.artist === "Unknown") updatedMeta.artist = "Various Artists";
        if (!updatedMeta.writers || updatedMeta.writers === "Unknown") updatedMeta.writers = updatedMeta.artist;

        cache[asset.id!] = updatedMeta;
      }
    } catch (err: any) {
      console.error(`[Metadata-Fetcher] 파트너 API 배분 조회 실패 (${batch[0]}...):`, err.message);
    }
    
    if (i % 500 === 0) fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
    await new Promise(r => setTimeout(r, 200));
  }

  // 2. 비디오 API를 통한 보완 (제목이 여전히 없는 경우)
  const emptyTitleAssets = uniqueIds.filter(id => !cache[id]?.title || cache[id]?.title === "Unknown Title");
  if (emptyTitleAssets.length > 0) {
    console.log(`[Metadata-Fetcher] 제목이 없는 ${emptyTitleAssets.length}개 자산에 대해 비디오 스니펫 조회 시작...`);
    for (const aid of emptyTitleAssets) {
      const vids = Array.from(assetToVideoIds.get(aid) || []);
      if (vids.length === 0) continue;

      try {
        const vRes = await youtube.videos.list({ part: ["snippet"], id: [vids[0]] });
        const snippet = vRes.data.items?.[0]?.snippet;
        if (snippet) {
          console.log(`[Metadata-Fetcher] 자산 ${aid} 제목 보완: ${snippet.title}`);
          cache[aid].title = snippet.title;
          if (cache[aid].artist === "Various Artists") cache[aid].artist = snippet.channelTitle || "Various Artists";
        }
      } catch (e) {}
    }
  }

  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`✅ [Metadata-Fetcher] 업데이트 완료!`);
}



fetchRealMetadata().catch(console.error);
