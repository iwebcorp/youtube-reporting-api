import * as fs from "fs";
import * as path from "path";
import { parseCsvRows } from "../src/reporting/parsers.js";

// We need to implement parseCsvRows or use a simple line-by-line parser to avoid import complexities
// Since csv-parse might need to be imported or configured, let's write a simple stream parser
import * as readline from "readline";

const systemManagedDir = "C:/Users/iweb/youtube-API-prototype/reports/system-managed";

const files = [
  {
    name: "202604_content_owner_asset_ad_revenue_raw_a1_20260401_20260501_20260506.csv",
    type: "Ads Revenue"
  },
  {
    name: "202604_content_owner_asset_ad_adjustment_revenue_raw_a1_20260401__20260506.csv",
    type: "Ads Revenue (Adjustment)"
  },
  {
    name: "202604_music_content_owner_asset_red_revenue_raw_a1_20260401_20260501_20260506.csv",
    type: "Subscriptions Revenue"
  },
  {
    name: "202604_content_owner_claim_audio_tier_revenue_raw_a1_20260401__20260505.csv",
    type: "Audio Tier Revenue"
  }
];

function findColIdx(header: string[], names: string[]): number {
  return header.findIndex(h => names.includes(h.trim().toLowerCase()));
}

async function analyzeFile(fileName: string, type: string) {
  const filePath = path.join(systemManagedDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`${fileName}: File not found`);
    return;
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] = [];
  let partnerRevenueIdx = -1;
  let adjustmentTypeIdx = -1;
  let assetTypeIdx = -1;

  const adjGroup: Record<string, { count: number; sum: number }> = {};
  const assetTypeGroup: Record<string, { count: number; sum: number }> = {};
  let totalRevenue = 0;
  let lineCount = 0;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/\r$/, "").replace(/^\uFEFF/, "");
    lineCount++;

    if (lineCount === 1) {
      header = line.split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      partnerRevenueIdx = findColIdx(header, ["partner revenue usd", "partner revenue"]);
      adjustmentTypeIdx = findColIdx(header, ["adjustment type"]);
      assetTypeIdx = findColIdx(header, ["asset type"]);
      console.log(`\n[Analyzing ${fileName}]`);
      console.log(`Header columns: partnerRevenueIdx=${partnerRevenueIdx}, adjustmentTypeIdx=${adjustmentTypeIdx}, assetTypeIdx=${assetTypeIdx}`);
      continue;
    }

    if (line.trim() === "") continue;

    // Simple CSV parser that handles quotes
    const cells: string[] = [];
    let insideQuote = false;
    let currentCell = "";
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        cells.push(currentCell.trim().replace(/^"|"$/g, ""));
        currentCell = "";
      } else {
        currentCell += char;
      }
    }
    cells.push(currentCell.trim().replace(/^"|"$/g, ""));

    let revenue = 0;
    if (partnerRevenueIdx !== -1 && cells[partnerRevenueIdx]) {
      revenue = parseFloat(cells[partnerRevenueIdx]);
      if (isNaN(revenue)) revenue = 0;
    }

    const adjType = adjustmentTypeIdx !== -1 && cells[adjustmentTypeIdx] ? cells[adjustmentTypeIdx] : "None";
    const assetType = assetTypeIdx !== -1 && cells[assetTypeIdx] ? cells[assetTypeIdx] : "Unknown";

    totalRevenue += revenue;

    if (!adjGroup[adjType]) adjGroup[adjType] = { count: 0, sum: 0 };
    adjGroup[adjType].count++;
    adjGroup[adjType].sum += revenue;

    if (!assetTypeGroup[assetType]) assetTypeGroup[assetType] = { count: 0, sum: 0 };
    assetTypeGroup[assetType].count++;
    assetTypeGroup[assetType].sum += revenue;
  }

  console.log(`Type: ${type}, Total Lines: ${lineCount}, Total Revenue: ${totalRevenue}`);
  console.log("Adjustment Type breakdown:");
  for (const [adj, stat] of Object.entries(adjGroup)) {
    console.log(` - ${adj}: count=${stat.count}, sum=${stat.sum}`);
  }
  console.log("Asset Type breakdown:");
  for (const [at, stat] of Object.entries(assetTypeGroup)) {
    console.log(` - ${at}: count=${stat.count}, sum=${stat.sum}`);
  }
}

async function run() {
  for (const file of files) {
    await analyzeFile(file.name, file.type);
  }
}

run().catch(console.error);
