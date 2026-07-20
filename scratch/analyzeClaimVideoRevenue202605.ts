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

function latest(pattern: RegExp): string {
  const dir = path.resolve(process.cwd(), "reports", "system-managed");
  const files = fs.readdirSync(dir).filter((file) => pattern.test(file)).sort();
  if (files.length === 0) throw new Error(`No file for ${pattern}`);
  return path.join(dir, files[files.length - 1]!);
}

function inc(map: Map<string, { rows: number; total: number }>, key: string, amount: number): void {
  const bucket = map.get(key) ?? { rows: 0, total: 0 };
  bucket.rows += 1;
  bucket.total += amount;
  map.set(key, bucket);
}

async function summarize(filePath: string, revenueColumn: string): Promise<void> {
  console.log(`FILE ${path.basename(filePath)}`);
  const maps = {
    assetType: new Map<string, { rows: number; total: number }>(),
    claimType: new Map<string, { rows: number; total: number }>(),
    contentType: new Map<string, { rows: number; total: number }>(),
    prefix3: new Map<string, { rows: number; total: number }>(),
    combo: new Map<string, { rows: number; total: number }>(),
    country: new Map<string, { rows: number; total: number }>(),
  };
  let total = 0;
  let rows = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let headers: string[] | null = null;
  let idxCountry = -1;
  let idxAssetType = -1;
  let idxClaimType = -1;
  let idxContentType = -1;
  let idxCustomId = -1;
  let idxRevenue = -1;
  const findIndex = (headers: string[], names: string[]) => headers.findIndex((header) => names.includes(header));

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) continue;
    if (!headers) {
      headers = parseCsvLine(line);
      idxCountry = findIndex(headers, ["country", "Country"]);
      idxAssetType = findIndex(headers, ["asset_type", "Asset Type"]);
      idxClaimType = findIndex(headers, ["claim_type", "Claim Type"]);
      idxContentType = findIndex(headers, ["content_type", "Content Type"]);
      idxCustomId = findIndex(headers, ["custom_id", "Custom ID"]);
      idxRevenue = findIndex(headers, [revenueColumn, "Partner Revenue", "partner_revenue", "partner_revenue_usd"]);
      if (idxCountry < 0 || idxRevenue < 0) throw new Error(`Missing columns: ${headers.join("|")}`);
      continue;
    }
    const values = parseCsvLine(line);
    if (values.length !== headers.length) continue;
    const country = String(values[idxCountry] ?? "").trim();
    const revenue = Number(values[idxRevenue] ?? "0");
    if (!Number.isFinite(revenue)) continue;
    inc(maps.country, country, revenue);
    if (country !== "KR") continue;
    rows += 1;
    total += revenue;
    const assetType = String(values[idxAssetType] ?? "").trim();
    const claimType = String(values[idxClaimType] ?? "").trim();
    const contentType = String(values[idxContentType] ?? "").trim();
    const customId = String(values[idxCustomId] ?? "").trim();
    const prefix3 = customId.slice(0, 3) || "(blank)";
    inc(maps.assetType, assetType, revenue);
    inc(maps.claimType, claimType, revenue);
    inc(maps.contentType, contentType, revenue);
    inc(maps.prefix3, prefix3, revenue);
    inc(maps.combo, `${assetType}|${claimType}|${contentType}|${prefix3}`, revenue);
  }

  console.log(`KR rows=${rows} total=${total.toFixed(12)}`);
  for (const [label, map] of Object.entries(maps)) {
    console.log(`-- ${label}`);
    for (const [key, bucket] of [...map.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, 20)) {
      console.log(`${key}\trows=${bucket.rows}\ttotal=${bucket.total.toFixed(12)}`);
    }
  }
}

async function main(): Promise<void> {
  await summarize("202605cms/YouTube_kwangsoomedia_M_20260501_claim_raw_v1-1.csv", "Partner Revenue");
  await summarize("202605cms/YouTube_kwangsoomedia_M_20260501_ADJ_claim_raw_v1-1.csv", "Partner Revenue");
  await summarize(latest(/^202605_content_owner_claim_ad_revenue_raw_a1_.*\.csv$/), "partner_revenue");
  await summarize(latest(/^202605_content_owner_claim_ad_adjustment_revenue_raw_a1_.*\.csv$/), "partner_revenue");
  await summarize(latest(/^202605_music_content_owner_red_revenue_raw_a1_.*\.csv$/), "partner_revenue_usd");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
