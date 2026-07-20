import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

type Bucket = { rows: number; total: number };

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

function inc(map: Map<string, Bucket>, key: string, amount: number): void {
  const bucket = map.get(key) ?? { rows: 0, total: 0 };
  bucket.rows += 1;
  bucket.total += amount;
  map.set(key, bucket);
}

function print(label: string, map: Map<string, Bucket>, limit = 30): void {
  console.log(`-- ${label}`);
  for (const [key, bucket] of [...map.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)).slice(0, limit)) {
    console.log(`${key}\trows=${bucket.rows}\ttotal=${bucket.total.toFixed(12)}`);
  }
}

async function analyze(filePath: string, revenueColumn: string, options: { skipSummary?: boolean; onlyKR?: boolean } = {}): Promise<void> {
  console.log(`FILE ${filePath}`);
  const maps = {
    country: new Map<string, Bucket>(),
    prefix3: new Map<string, Bucket>(),
    prefix6: new Map<string, Bucket>(),
    assetType: new Map<string, Bucket>(),
    claimType: new Map<string, Bucket>(),
    contentType: new Map<string, Bucket>(),
    rightType: new Map<string, Bucket>(),
    musicClaimType: new Map<string, Bucket>(),
    ownership: new Map<string, Bucket>(),
    combo: new Map<string, Bucket>(),
  };
  let total = 0;
  let rows = 0;
  let headers: string[] | null = null;
  let skipped = false;
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line) continue;
    if (options.skipSummary && !skipped && line === "Asset Summary") {
      skipped = true;
      continue;
    }
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    const values = parseCsvLine(line);
    if (values.length !== headers.length) continue;
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const country = String(row.Country ?? row.country ?? "").trim();
    if (options.onlyKR && country !== "KR") continue;
    const revenue = Number(row[revenueColumn] ?? row["Partner Revenue"] ?? row.partner_revenue ?? row.partner_revenue_usd ?? 0);
    if (!Number.isFinite(revenue)) continue;
    rows += 1;
    total += revenue;
    const customId = String(row["Custom ID"] ?? row.custom_id ?? "").trim();
    const assetType = String(row["Asset Type"] ?? row.asset_type ?? "").trim();
    const claimType = String(row["Claim Type"] ?? row.claim_type ?? "").trim();
    const contentType = String(row["Content Type"] ?? row.content_type ?? "").trim();
    const rightType = String(row["Composition Right Type"] ?? "").trim();
    const musicClaimType = String(row["Music Claim Type"] ?? "").trim();
    const ownership = String(row["Ownership Percentage"] ?? "").trim();
    inc(maps.country, country || "(blank)", revenue);
    inc(maps.prefix3, customId.slice(0, 3) || "(blank)", revenue);
    inc(maps.prefix6, customId.slice(0, 6) || "(blank)", revenue);
    inc(maps.assetType, assetType || "(blank)", revenue);
    inc(maps.claimType, claimType || "(blank)", revenue);
    inc(maps.contentType, contentType || "(blank)", revenue);
    inc(maps.rightType, rightType || "(blank)", revenue);
    inc(maps.musicClaimType, musicClaimType || "(blank)", revenue);
    inc(maps.ownership, ownership || "(blank)", revenue);
    inc(maps.combo, `${customId.slice(0, 3) || "(blank)"}|${assetType || "(blank)"}|${claimType || "(blank)"}|${contentType || "(blank)"}|${musicClaimType || "(blank)"}|${rightType || "(blank)"}|${ownership || "(blank)"}`, revenue);
  }
  console.log(`rows=${rows} total=${total.toFixed(12)}`);
  for (const [label, map] of Object.entries(maps)) print(label, map);
}

async function main(): Promise<void> {
  await analyze(path.resolve("저작", "1.YouTube_kwangsoomedia_pla_M_20260101_20260131_rev_views_by_asset_v1-0.csv"), "Partner Revenue", { onlyKR: true });
  await analyze(path.resolve("저작", "2.YouTube_kwangsoomedia_pla_M_20260101_ADJ_asset_raw_v1-1.csv"), "Partner Revenue", { onlyKR: true });
  await analyze(path.resolve("저작", "3.YouTube_kwangsoomedia_pla_M_20260101_20260131_red_pubs_rawdata_asset_v1-1.csv"), "Partner Revenue", { skipSummary: true, onlyKR: true });
  await analyze(path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_asset_raw_v1-1.csv"), "Partner Revenue", { onlyKR: true });
  await analyze(path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_ADJ_asset_raw_v1-1.csv"), "Partner Revenue", { onlyKR: true });
  await analyze(path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_20260531_red_label_rawdata_asset_v1-1.csv"), "Partner Revenue", { skipSummary: true, onlyKR: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
