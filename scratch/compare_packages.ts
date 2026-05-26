import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// Correct CSV line parser handling double quotes
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(s => s.trim().replace(/^"(.*)"$/, "$1"));
}

async function sumPackageDir(dirPath: string) {
  console.log(`\n==================================================`);
  console.log(`Summing Package: ${path.basename(dirPath)}`);
  console.log(`==================================================`);

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

  for (const fileName of files) {
    const filePath = path.join(dirPath, fileName);
    if (!fs.existsSync(filePath)) {
      console.log(`- ${fileName}: NOT FOUND`);
      continue;
    }

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let headers: string[] = [];
    let partnerRevIdx = -1;
    let totalRevenue = 0;
    let lineCount = 0;
    let isFirstLine = true;

    for await (const rawLine of rl) {
      const line = rawLine.replace(/\r$/, "").replace(/^\uFEFF/, "");
      lineCount++;

      // skip ddex headers or empty headers
      if (fileName.includes("3_") && lineCount === 1 && line === "Asset Summary") {
        continue;
      }
      if (fileName.includes("4_") && line.startsWith("HEAD")) {
        continue;
      }

      if (isFirstLine) {
        headers = parseCsvLine(line.toLowerCase());
        // Look for partner revenue
        partnerRevIdx = headers.findIndex(h => h === "partner revenue" || h === "partner_revenue" || h.includes("partner revenue"));
        isFirstLine = false;
        continue;
      }

      if (line.trim() === "") continue;

      const row = parseCsvLine(line);
      if (partnerRevIdx !== -1 && row.length > partnerRevIdx) {
        const val = parseFloat(row[partnerRevIdx]) || 0;
        totalRevenue += val;
      }
    }

    console.log(`- ${fileName}: lines=${lineCount}, partner_revenue_sum=${totalRevenue.toFixed(6)} (headerIdx=${partnerRevIdx})`);
  }
}

async function run() {
  const v19Dir = "C:/Users/iweb/youtube-API-prototype/reports_final_v19_202603_client_package";
  const v20Dir = "C:/Users/iweb/youtube-API-prototype/reports_final_v20_202604_client_package";
  await sumPackageDir(v19Dir);
  await sumPackageDir(v20Dir);
}

run().catch(console.error);
