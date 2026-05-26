import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const clientPackageDir = "C:/Users/iweb/youtube-API-prototype/reports_final_v20_202604_client_package";

const files = [
  "1_neighboring_daily_ad.csv",
  "1_publishing_daily_ad.csv",
  "2_neighboring_daily_ad_adj.csv",
  "2_publishing_daily_ad_adj.csv",
  "3_neighboring_monthly_sub.csv",
  "3_publishing_monthly_sub.csv",
  "4_neighboring_financial_detail.csv",
  "4_publishing_ddex_dsr.csv"
];

async function sumFile(fileName: string) {
  const filePath = path.join(clientPackageDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`${fileName}: File not found`);
    return;
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] = [];
  let partnerRevenueIdx = -1;
  let totalRevenue = 0;
  let lineCount = 0;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/\r$/, "").replace(/^\uFEFF/, "");
    lineCount++;

    if (fileName.includes("3_") && lineCount === 1 && line === "Asset Summary") {
      // 3_neighboring_monthly_sub.csv 나 3_publishing_monthly_sub.csv 의 경우 첫줄이 "Asset Summary" 일 수 있음
      continue;
    }

    if (header.length === 0) {
      header = line.split(",");
      partnerRevenueIdx = header.findIndex(h => h.trim() === "Partner Revenue");
      if (partnerRevenueIdx === -1) {
        // 혹시 다른 이름의 컬럼이 있는지 확인하기 위해
        partnerRevenueIdx = header.findIndex(h => h.trim().toLowerCase().includes("partner revenue"));
      }
      console.log(`\n[${fileName}]`);
      console.log(`Header: ${header.join(" | ")}`);
      console.log(`Target Column Index: ${partnerRevenueIdx} (${partnerRevenueIdx !== -1 ? header[partnerRevenueIdx] : "NOT FOUND"})`);
      continue;
    }

    if (line.trim() === "") continue;

    const cells = line.split(",");
    if (partnerRevenueIdx !== -1 && cells[partnerRevenueIdx]) {
      const val = parseFloat(cells[partnerRevenueIdx].trim());
      if (!isNaN(val)) {
        totalRevenue += val;
      }
    }
  }

  console.log(`Lines: ${lineCount}, Total Partner Revenue: ${totalRevenue}`);
}

async function run() {
  for (const file of files) {
    await sumFile(file);
  }
}

run().catch(console.error);
