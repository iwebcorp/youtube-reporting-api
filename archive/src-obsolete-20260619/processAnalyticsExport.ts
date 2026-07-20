import * as fs from "fs";
import * as path from "path";

async function processAnalyticsExport() {
  const exportPath = path.join(process.cwd(), "reports", "표 데이터.csv");
  
  if (!fs.existsSync(exportPath)) {
    console.error(`[Error] ${exportPath} 파일을 찾을 수 없습니다.`);
    return;
  }

  console.log("[Converter] '표 데이터.csv' 분석 및 변환을 시작합니다...");

  // 한글 깨짐 방지 로직
  const buffer = fs.readFileSync(exportPath);
  let content = "";
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    content = buffer.toString("utf16le");
    console.log("- 인코딩 감지: UTF-16LE (BOM)");
  } else if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    content = buffer.toString("utf-8");
    console.log("- 인코딩 감지: UTF-8 (BOM)");
  } else {
    content = buffer.toString("utf-8");
    console.log("- 인코딩 감지: UTF-8 / Standard");
  }

  const lines = content.split(/\r?\n/);
  const header = lines[0].toLowerCase();
  const sep = content.includes("\t") ? "\t" : ","; // 탭 구분자(TSV) 대응
  const cols = header.split(sep);

  const iAssetOrVideo = cols.findIndex(c => c.includes("asset") || c.includes("저작물") || c.includes("콘텐츠") || c.includes("동영상") || c.includes("item"));
  const iViews = cols.findIndex(c => c.includes("views") || c.includes("조회수"));
  const iCountry = cols.findIndex(c => c.includes("country") || c.includes("국가") || c.includes("지역"));

  if (iAssetOrVideo === -1 || iViews === -1) {
    console.error("[Error] 필수 컬럼을 찾을 수 없습니다. (ID 및 조회수)");
    return;
  }

  const rawStats: Record<string, number> = {};
  let totalRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("합계") || line.startsWith("Total")) continue;
    
    const row = line.split(sep);
    const rawId = row[iAssetOrVideo]?.replace(/"/g, "").trim();
    const views = parseInt(row[iViews]?.replace(/"/g, "").trim() || "0", 10);

    if (rawId && !isNaN(views)) {
      rawStats[rawId] = (rawStats[rawId] || 0) + views;
      totalRows++;
    }
  }

  // 수익 리포트에서 Video-Asset 매핑 및 Asset ID 직접 매칭 준비
  console.log("[Converter] 수익 리포트에서 매핑 데이터 구축 중...");
  const reportsDir = path.join(process.cwd(), "reports");
  const reportFiles = fs.readdirSync(reportsDir).filter(f => f.startsWith("report_2026-03") && f.endsWith(".csv"));
  
  const videoToAsset: Record<string, string> = {};
  const knownAssets = new Set<string>();

  for (const file of reportFiles) {
    const reportContent = fs.readFileSync(path.join(reportsDir, file), "utf-8");
    const rLines = reportContent.split("\n").slice(1);
    for (const rl of rLines) {
      const c = rl.split(",");
      if (c.length >= 4) {
        if (c[2]) videoToAsset[c[2]] = c[3]; // video_id -> asset_id
        if (c[3]) knownAssets.add(c[3]);     // asset_id 존재여부
      }
    }
  }

  const usageData: Record<string, Record<string, { views: number }>> = {};
  for (const [id, views] of Object.entries(rawStats)) {
    let targetAssetId = "";
    
    if (knownAssets.has(id)) {
      targetAssetId = id; // 바로 Asset ID인 경우
    } else if (videoToAsset[id]) {
      targetAssetId = videoToAsset[id]; // Video ID인 경우 매핑
    }

    if (targetAssetId) {
      if (!usageData[targetAssetId]) usageData[targetAssetId] = { "TOTAL": { views: 0 } };
      usageData[targetAssetId]["TOTAL"].views += views;
    }
  }

  const cachePath = path.join(process.cwd(), "usage_data_cache.json");
  fs.writeFileSync(cachePath, JSON.stringify(usageData, null, 2));
  console.log(`[Converter] ✅ 변환 완료! ${totalRows}행 분석 완료, ${Object.keys(usageData).length}개 자산 매칭됨.`);
}

processAnalyticsExport().catch(console.error);
