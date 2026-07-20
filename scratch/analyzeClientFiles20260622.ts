import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";

type Row = Record<string, string>;

interface FileSummary {
  file: string;
  rows: number;
  total: number;
  byCountry: Map<string, { rows: number; total: number }>;
}

function parseRows(filePath: string, skipAssetSummary = false): Row[] {
  let text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  if (skipAssetSummary && text.startsWith("Asset Summary")) {
    text = text.replace(/^Asset Summary\r?\n/, "");
  }
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  }) as Row[];
}

function summarize(filePath: string, skipAssetSummary = false): FileSummary {
  const rows = parseRows(filePath, skipAssetSummary);
  const byCountry = new Map<string, { rows: number; total: number }>();
  let total = 0;
  for (const row of rows) {
    const country = String(row.Country ?? row.country ?? "").trim() || "(blank)";
    const amount = Number(String(row["Partner Revenue"] ?? row.partner_revenue ?? "0").replace(/,/g, "")) || 0;
    total += amount;
    const bucket = byCountry.get(country) ?? { rows: 0, total: 0 };
    bucket.rows += 1;
    bucket.total += amount;
    byCountry.set(country, bucket);
  }
  return { file: filePath, rows: rows.length, total, byCountry };
}

function printSummary(label: string, summary: FileSummary): void {
  console.log(`\n${label}`);
  console.log(`file=${summary.file}`);
  console.log(`rows=${summary.rows}`);
  console.log(`total=${summary.total.toFixed(12)}`);
  for (const [country, bucket] of [...summary.byCountry.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 20)) {
    console.log(`${country}\trows=${bucket.rows}\ttotal=${bucket.total.toFixed(12)}`);
  }
}

const base = path.resolve(process.cwd(), "20260622");
const files = [
  ["1", path.join(base, "1.YouTube_kwangsoomedia_pla_M_20260501_20260531_rev_views_by_asset_v1-0.csv"), false],
  [
    "2",
    path.join(
      base,
      "2.YouTube_kwangsoomedia_pla_M_20260501_ADJ_asset_raw_v1-1.csv",
      "2.YouTube_kwangsoomedia_pla_M_20260501_ADJ_asset_raw_v1-1.csv",
    ),
    false,
  ],
  [
    "3",
    path.join(
      base,
      "3.YouTube_kwangsoomedia_pla_M_20260501_20260531_red_pubs_rawdata_asset_v1-1.csv",
      "3.YouTube_kwangsoomedia_pla_M_20260501_20260531_red_pubs_rawdata_asset_v1-1.csv",
    ),
    true,
  ],
  [
    "4",
    path.join(
      base,
      "4.YouTube_kwangsoomedia_pla_20260501_HardwareAudioTierRevenue.csv",
      "4.YouTube_kwangsoomedia_pla_20260501_HardwareAudioTierRevenue.csv",
    ),
    false,
  ],
] as const;

for (const [label, filePath, skipAssetSummary] of files) {
  printSummary(label, summarize(filePath, skipAssetSummary));
}

const summaryDir = path.join(base, "YouTube_kwangsoomedia_pla_20260501_summary.csv");
if (fs.existsSync(summaryDir)) {
  const [summaryFile] = fs.readdirSync(summaryDir).map((name) => path.join(summaryDir, name));
  if (summaryFile) {
    console.log("\nsummary file first rows");
    const rows = parseRows(summaryFile).slice(0, 20);
    console.log(rows);
  }
}
