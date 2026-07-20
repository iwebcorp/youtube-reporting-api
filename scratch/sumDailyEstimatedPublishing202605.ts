import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

interface Totals {
  rows: number;
  total: number;
  ad: number;
  red: number;
  byCountry: Map<string, { rows: number; total: number; ad: number; red: number }>;
}

function add(totals: Totals, country: string, total: number, ad: number, red: number): void {
  totals.rows += 1;
  totals.total += total;
  totals.ad += ad;
  totals.red += red;
  const bucket = totals.byCountry.get(country) ?? { rows: 0, total: 0, ad: 0, red: 0 };
  bucket.rows += 1;
  bucket.total += total;
  bucket.ad += ad;
  bucket.red += red;
  totals.byCountry.set(country, bucket);
}

async function summarize(filePath: string, assetIds: Set<string>, totals: Totals): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let headers: string[] | null = null;
  let assetIndex = -1;
  let countryIndex = -1;
  let totalIndex = -1;
  let adIndex = -1;
  let redIndex = -1;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) continue;
    if (!headers) {
      headers = parseCsvLine(line);
      assetIndex = headers.indexOf("asset_id");
      countryIndex = headers.indexOf("country_code");
      totalIndex = headers.indexOf("estimated_partner_revenue");
      adIndex = headers.indexOf("estimated_partner_ad_revenue");
      redIndex = headers.indexOf("estimated_partner_red_revenue");
      continue;
    }
    const values = parseCsvLine(line);
    if (values.length !== headers.length) continue;
    const assetId = String(values[assetIndex] ?? "").trim();
    if (!assetIds.has(assetId)) continue;
    add(
      totals,
      String(values[countryIndex] ?? "").trim(),
      Number(values[totalIndex] ?? 0),
      Number(values[adIndex] ?? 0),
      Number(values[redIndex] ?? 0),
    );
  }
}

async function main(): Promise<void> {
  const assetIds = new Set(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "publishing_asset_ids.json"), "utf8")));
  const reportsDir = path.resolve(process.cwd(), "reports");
  const files = fs
    .readdirSync(reportsDir)
    .filter((fileName) => /^report_2026-05-\d{2}_content_owner_asset_estimated_revenue_.*\.csv$/.test(fileName))
    .sort();
  const totals: Totals = { rows: 0, total: 0, ad: 0, red: 0, byCountry: new Map() };
  for (const fileName of files) {
    await summarize(path.join(reportsDir, fileName), assetIds, totals);
  }
  console.log(`files=${files.length} rows=${totals.rows} total=${totals.total.toFixed(12)} ad=${totals.ad.toFixed(12)} red=${totals.red.toFixed(12)}`);
  for (const [country, bucket] of [...totals.byCountry.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 20)) {
    console.log(`${country}: rows=${bucket.rows} total=${bucket.total.toFixed(12)} ad=${bucket.ad.toFixed(12)} red=${bucket.red.toFixed(12)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
