import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import iconv from "iconv-lite";


async function rebuild() {
  const cachePath = path.join(process.cwd(), "asset_metadata_cache.json");
  const cache: any = {};

  const folders = ["저작", "인접"];
  
  for (const folder of folders) {
    const dir = path.join(process.cwd(), folder);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter(f => f.endsWith(".csv"));
    for (const file of files) {
      console.log(`[Rebuilder] Scanning ${file}...`);
      const filePath = path.join(dir, file);
      
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath).pipe(iconv.decodeStream("cp949")),
        crlfDelay: Infinity
      });


      let colMap: Record<string, number> = {};
      let isHeader = true;

      for await (const line of rl) {
        if (!line.trim()) continue;
        const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ''));
        
        if (isHeader) {
          cols.forEach((c, i) => { colMap[c.toLowerCase()] = i; });
          // 헤더에 필수 정보가 없으면 이 리포트는 스팁 (단, Financial Detail 등은 "Asset ID"를 가짐)
          if (!colMap["asset id"]) {
             // 일부 파일은 첫번째 줄이 헤더가 아닐 수 있음 (DSR 등)
             continue; 
          }
          isHeader = false;
          continue;
        }

        const aid = cols[colMap["asset id"]];
        if (!aid || !aid.startsWith("A")) continue;

        // 이미 더 구체적인 정보가 있으면 덮어쓰지 않음 (단, Unknown이면 업데이트)
        const existing = cache[aid] || {};
        
        const title = cols[colMap["asset title"]] || cols[colMap["title"]];
        const customId = cols[colMap["custom id"]];
        const isrc = cols[colMap["isrc"]];
        const artist = cols[colMap["artist"]];
        const writer = cols[colMap["writers"]] || cols[colMap["writer"]];
        const label = cols[colMap["label"]] || cols[colMap["asset labels"]];
        const type = cols[colMap["asset type"]];

        cache[aid] = {
          title: title || existing.title || "",
          customId: customId || existing.customId || "",
          isrc: isrc || existing.isrc || "",
          writers: writer || existing.writers || artist || "Various Artists",
          artist: artist || existing.artist || "Various Artists",
          label: label || existing.label || "Unknown Label",
          assetType: type || existing.assetType || (aid.length > 15 ? "Composition" : "Sound Recording")
        };
      }
    }
  }

  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
  console.log(`✅ [Rebuilder] ${Object.keys(cache).length}개의 자산 메타데이터를 원천 리포트에서 복구 완료!`);
}

rebuild().catch(console.error);
