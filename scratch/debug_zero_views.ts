import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

async function debug() {
  const filePath = "reports_final_v2/1_neighboring_daily_ad.csv";
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  let headerMap: Record<string, number> = {};
  let isHeader = true;
  let count = 0;

  for await (const line of rl) {
    if (isHeader) {
      const cols = line.replace(/^\uFEFF/, "").split(",").map(c => c.trim().toLowerCase());
      cols.forEach((c, i) => headerMap[c] = i);
      isHeader = false;
      continue;
    }

    const cols = line.split(",");
    const rev = parseFloat(cols[headerMap["partner revenue"]] || "0");
    const views = parseInt(cols[headerMap["owned views"]] || "0");

    if (rev > 0 && views === 0) {
      console.log("--- Problematic Row Found ---");
      console.log("Line Content:", line);
      console.log("Mapped Revenue:", rev);
      console.log("Mapped Views:", views);
      console.log("Asset ID:", cols[headerMap["asset id"]]);
      count++;
      if (count >= 5) break;
    }
  }
}

debug().catch(console.error);
