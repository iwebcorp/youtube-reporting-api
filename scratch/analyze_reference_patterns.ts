import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

async function analyze(filePath: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  let totalRows = 0;
  let hasViewsCount = 0;
  let hasRevCount = 0;
  let bothZeroCount = 0;
  let granularStats: any = { watch: 0, embed: 0, channel: 0, live: 0, onDemand: 0 };
  
  let headerMap: Record<string, number> = {};
  let isHeader = true;

  for await (const line of rl) {
    totalRows++;
    if (isHeader) {
      line.split(",").forEach((c, idx) => { headerMap[c.trim().toLowerCase()] = idx; });
      isHeader = false;
      continue;
    }

    const cols = line.split(",");
    const views = parseInt(cols[headerMap["owned views"]] || "0");
    const rev = parseFloat(cols[headerMap["partner revenue"]] || "0");
    
    if (views > 0) hasViewsCount++;
    if (rev > 0) hasRevCount++;
    if (views === 0 && rev === 0) bothZeroCount++;

    if ((parseInt(cols[headerMap["owned views : watch page"]] || "0")) > 0) granularStats.watch++;
    if ((parseInt(cols[headerMap["owned views : embedded player"]] || "0")) > 0) granularStats.embed++;
    if ((parseInt(cols[headerMap["owned views : channel page"]] || "0")) > 0) granularStats.channel++;
    if ((parseInt(cols[headerMap["owned views : live"]] || "0")) > 0) granularStats.live++;
    if ((parseInt(cols[headerMap["owned views : on demand"]] || "0")) > 0) granularStats.onDemand++;
  }

  console.log(`\n--- Analysis: ${path.basename(filePath)} ---`);
  console.log(`Total Records: ${totalRows - 1}`);
  console.log(`Rows with Views > 0: ${hasViewsCount} (${Math.round(hasViewsCount/totalRows*100)}%)`);
  console.log(`Rows with Revenue > 0: ${hasRevCount} (${Math.round(hasRevCount/totalRows*100)}%)`);
  console.log(`Rows with Both 0: ${bothZeroCount}`);
  console.log(`Granular Field Activity:`, granularStats);
}

async function run() {
  const pubFile = "저작/1.YouTube_kwangsoomedia_pla_M_20260101_20260131_rev_views_by_asset_v1-0.csv";
  const neiFile = "인접/1.YouTube_kwangsoomedia_M_20260101_asset_raw_v1-1.csv";
  
  if (fs.existsSync(pubFile)) await analyze(pubFile);
  if (fs.existsSync(neiFile)) await analyze(neiFile);
}

run().catch(console.error);
