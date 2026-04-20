import * as fs from "fs";
import * as path from "path";

const reportFile = "reports/report_2026-03-01_19799734.csv";
const content = fs.readFileSync(reportFile, "utf-8");
const lines = content.split("\n");
const header = lines[0];
const map: Record<string, number> = {};
header.split(",").forEach((col, idx) => { map[col.trim().toLowerCase()] = idx; });

console.log("Column Map:", map);

const iAid = map["asset_id"];
const iRed = map["estimated_partner_red_revenue"];

let count = 0;
let totalRed = 0;

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(",");
  const aid = cols[iAid];
  if (!aid) continue;
  const redRev = parseFloat(cols[iRed] || "0");
  if (redRev > 0) {
    count++;
    totalRed += redRev;
    if (count < 5) console.log(`Found Red Rev: aid=${aid}, rev=${redRev}`);
  }
}

console.log(`Total rows with red revenue: ${count}`);
console.log(`Total red revenue sum: ${totalRed}`);
