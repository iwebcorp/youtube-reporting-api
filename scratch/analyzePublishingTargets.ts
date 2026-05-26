import * as path from "path";
import { parseCsvRows } from "../src/reporting/parsers.js";

function sumBy(rows: Record<string, string>[], key: string, valueKey: string): Array<{ key: string; sum: number; count: number }> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const bucket = (row[key] ?? "").trim() || "(blank)";
    const value = Number((row[valueKey] ?? "0").trim()) || 0;
    const entry = totals.get(bucket) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count += 1;
    totals.set(bucket, entry);
  }

  return Array.from(totals.entries())
    .map(([groupKey, value]) => ({ key: groupKey, sum: value.sum, count: value.count }))
    .sort((left, right) => right.sum - left.sum);
}

async function run(): Promise<void> {
  const filePath = path.resolve(process.cwd(), process.argv[2] ?? "reports_final_v27_202604_client_package/1_publishing_daily_ad.csv");
  const rows = await parseCsvRows(filePath);
  console.log(`[AnalyzePublishingTargets] rows=${rows.length} file=${filePath}`);

  for (const [groupKey, valueKey, limit] of [
    ["Country", "Partner Revenue", 20],
    ["Composition Right Type", "Partner Revenue", 20],
    ["Music Claim Type", "Partner Revenue", 20],
    ["Custom ID", "Partner Revenue", 30],
  ] as const) {
    console.log(`\n[AnalyzePublishingTargets] group=${groupKey}`);
    for (const entry of sumBy(rows, groupKey, valueKey).slice(0, limit)) {
      console.log(`${entry.key}\t${entry.sum.toFixed(12)}\t${entry.count}`);
    }
  }
}

run().catch((error) => {
  console.error("[AnalyzePublishingTargets] Failed.", error);
  process.exitCode = 1;
});
