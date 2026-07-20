import * as fs from "fs";
import * as readline from "readline";

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === "\"") {
        current += "\"";
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

async function summarize(filePath: string, revenueHeader = "Partner Revenue", skipAssetSummary = false): Promise<void> {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  let headers: string[] | null = null;
  let skipped = false;
  let countryIndex = -1;
  let revenueIndex = -1;
  const byCountry = new Map<string, { rows: number; total: number }>();
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) continue;
    if (skipAssetSummary && !skipped && line === "Asset Summary") {
      skipped = true;
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line);
      countryIndex = headers.findIndex((header) => header === "Country" || header === "country");
      revenueIndex = headers.findIndex((header) => header === revenueHeader || header === "partner_revenue" || header === "partner_revenue_usd");
      if (countryIndex < 0 || revenueIndex < 0) {
        throw new Error(`Missing country/revenue in ${filePath}`);
      }
      continue;
    }
    const values = parseCsvLine(line);
    if (values.length !== headers.length) continue;
    const country = String(values[countryIndex] ?? "(blank)").trim() || "(blank)";
    const amount = Number(values[revenueIndex] ?? "0") || 0;
    const bucket = byCountry.get(country) ?? { rows: 0, total: 0 };
    bucket.rows += 1;
    bucket.total += amount;
    byCountry.set(country, bucket);
  }

  console.log(`\n${filePath}`);
  const ge = byCountry.get("GE");
  console.log(`GE rows=${ge?.rows ?? 0} total=${(ge?.total ?? 0).toFixed(12)}`);
  for (const [country, bucket] of [...byCountry.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 12)) {
    console.log(`${country}\trows=${bucket.rows}\ttotal=${bucket.total.toFixed(12)}`);
  }
}

await summarize("202605cms/YouTube_kwangsoomedia_M_20260501_asset_raw_v1-1.csv");
await summarize("202605cms/YouTube_kwangsoomedia_M_20260501_ADJ_asset_raw_v1-1.csv");
await summarize("202605cms/YouTube_kwangsoomedia_M_20260501_20260531_red_label_rawdata_asset_v1-1.csv", "Partner Revenue", true);
await summarize("202605cms/YouTube_kwangsoomedia_M_20260501_20260531_red_rawdata_asset_v1-1.csv", "Partner Revenue", true);
await summarize("202605cms/YouTube_kwangsoomedia_Audio_Tier_20260501_Financial_Detail_v1-0.csv");
