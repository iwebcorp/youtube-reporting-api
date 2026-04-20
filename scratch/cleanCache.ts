// 캐시 내 가짜 대체값 정리
import * as fs from "fs";
const cacheFile = "asset_metadata_cache.json";
const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));

const fakes = ["Unknown Label", "Unknown Artist", "Unknown Title"];
let count = 0;

for (const [id, meta] of Object.entries(data) as [string, any][]) {
  for (const key of Object.keys(meta)) {
    if (fakes.includes(meta[key])) {
      meta[key] = "";
      count++;
    }
  }
}

fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
console.log(`✅ 캐시 내 가짜 대체값 ${count}건 정리 완료`);
