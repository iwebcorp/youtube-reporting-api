import * as fs from "fs";
import * as readline from "readline";

// 저작권 1번 클라이언트 원본에서 Asset ID 추출
async function getAssetIds(filePath: string, assetColIdx: number): Promise<Set<string>> {
  const ids = new Set<string>();
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    const cols = line.split(",");
    const id = cols[assetColIdx]?.trim();
    if (id) ids.add(id);
  }
  return ids;
}

async function run() {
  // 저작권(publishing) 1번: Asset ID는 0번 컬럼
  const pubIds = await getAssetIds("저작/1.YouTube_kwangsoomedia_pla_M_20260101_20260131_rev_views_by_asset_v1-0.csv", 0);
  console.log(`저작권 원본 고유 Asset ID 수: ${pubIds.size}`);

  // 인접권(neighboring) 1번: Asset ID는 3번 컬럼
  const nbIds = await getAssetIds("인접/1.YouTube_kwangsoomedia_M_20260101_asset_raw_v1-1.csv", 3);
  console.log(`인접권 원본 고유 Asset ID 수: ${nbIds.size}`);

  // 겹치는 자산
  let overlap = 0;
  for (const id of pubIds) { if (nbIds.has(id)) overlap++; }
  console.log(`겹치는 Asset ID 수: ${overlap}`);
  console.log(`저작권만 있는 Asset ID: ${pubIds.size - overlap}`);
  console.log(`인접권만 있는 Asset ID: ${nbIds.size - overlap}`);

  // 합집합
  const union = new Set([...pubIds, ...nbIds]);
  console.log(`합집합 Asset ID: ${union.size}`);

  // 우리 raw report에서 나오는 총 고유 asset ID
  const reportDir = "reports";
  const rawIds = new Set<string>();
  const files = fs.readdirSync(reportDir).filter(f => f.match(/report_2026-03/));
  for (const file of files.slice(0, 1)) {
    const rl = readline.createInterface({ input: fs.createReadStream(`${reportDir}/${file}`), crlfDelay: Infinity });
    let isHeader = true;
    for await (const line of rl) {
      if (isHeader) { isHeader = false; continue; }
      const cols = line.split(",");
      const id = cols[3]?.trim(); // asset_id column
      if (id) rawIds.add(id);
    }
  }
  console.log(`\nRaw report (1일치) 고유 Asset ID 수: ${rawIds.size}`);

  // raw의 asset들이 저작/인접 어디에 속하는지 확인
  let inPub = 0, inNb = 0, inBoth = 0, inNeither = 0;
  for (const id of rawIds) {
    const p = pubIds.has(id), n = nbIds.has(id);
    if (p && n) inBoth++;
    else if (p) inPub++;
    else if (n) inNb++;
    else inNeither++;
  }
  console.log(`  저작권에만 있음: ${inPub}`);
  console.log(`  인접권에만 있음: ${inNb}`);
  console.log(`  양쪽 모두: ${inBoth}`);
  console.log(`  어느 쪽에도 없음: ${inNeither}`);
}

run().catch(console.error);
