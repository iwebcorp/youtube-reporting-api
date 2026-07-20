import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";
import * as fs from "fs";
import * as path from "path";

const cfg = loadConfig();

async function syncAllAssetMetadata() {
  const auth = await getAuthClient();

  const reportsDir = path.join(process.cwd(), "reports");
  const reportFiles = fs.readdirSync(reportsDir).filter(f => f.startsWith("report_2026-03") && f.endsWith(".csv"));
  
  const assetIds = new Set<string>();
  console.log("[Sync] 수익 리포트에서 자산 ID 추출 중...");
  
  for (const file of reportFiles) {
    const content = fs.readFileSync(path.join(reportsDir, file), "utf-8");
    const lines = content.split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = line.split(",");
      if (cols[3]) assetIds.add(cols[3]);
    }
  }

  const allAssetIds = Array.from(assetIds);
  console.log(`[Sync] 총 ${allAssetIds.length}개의 고유 자산을 발견했습니다.`);

  const cachePath = path.join(process.cwd(), cfg.cacheFile);
  const metadataCache: Record<string, any> = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf-8")) : {};

  const batchSize = 50;
  let syncedCount = 0;

  console.log("[Sync] 메타데이터 상세 동기화(Artist/Album/Label 포함) 시작...");

  for (let i = 0; i < allAssetIds.length; i += batchSize) {
    const batch = allAssetIds.slice(i, i + batchSize);
    
    // 필수 정보(가수명 등)가 없는 경우에만 새로 조회하여 효율성 극대화
    const needsSync = batch.filter(id => !metadataCache[id] || !metadataCache[id].artist);
    if (needsSync.length === 0) {
      syncedCount += batch.length;
      continue;
    }

    try {
      const idsParam = needsSync.join(",");
      // fetchMetadata=metadata 옵션을 추가하여 상세 정보를 가져옴
      const url = `https://www.googleapis.com/youtube/partner/v1/assets?id=${idsParam}&onBehalfOfContentOwner=${cfg.contentOwnerId}&fetchMetadata=metadata`;
      
      const res = await auth.request<any>({ url });

      if (res.data && res.data.items) {
        res.data.items.forEach((asset: any) => {
          // asset.metadata 에 상세 정보가 들어있는 경우가 많습니다.
          const m = asset.metadata || {};
          metadataCache[asset.id] = {
            id: asset.id,
            title: m.title || asset.title || "",
            customId: asset.customId || "",
            isrc: asset.isrc || m.isrc || "",
            upc: asset.upc || m.upc || "",
            grid: asset.grid || m.grid || "",
            artist: m.artist || "",
            album: m.album || "",
            label: m.label || "",
          };
        });
      }
      
      syncedCount += batch.length;
      if (syncedCount % 500 === 0 || syncedCount === allAssetIds.length) {
        console.log(`[Sync] 진행 중: ${syncedCount} / ${allAssetIds.length} (${Math.round((syncedCount/allAssetIds.length)*100)}%)`);
        fs.writeFileSync(cachePath, JSON.stringify(metadataCache, null, 2));
      }
    } catch (err: any) {
      console.error(`[Sync] 배치 조회 실패 (Index ${i}):`, err.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  fs.writeFileSync(cachePath, JSON.stringify(metadataCache, null, 2));
  console.log(`[Sync] ✅ 상세 메타데이터 동기화 완료!`);
}

syncAllAssetMetadata().catch(console.error);
