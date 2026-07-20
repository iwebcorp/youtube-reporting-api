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

async function loadCustomIds(filePath: string, options: { skipSummary?: boolean } = {}): Promise<Set<string>> {
  const ids = new Set<string>();
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  let headers: string[] | null = null;
  let skipped = false;
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
    const customId = String(row["Custom ID"] ?? row.custom_id ?? "").trim();
    if (customId) ids.add(customId);
  }
  return ids;
}

async function sumByCustomIds(
  filePath: string,
  customIds: Set<string>,
  options: { skipSummary?: boolean; country?: string; revenueColumn?: string } = {},
): Promise<{ rows: number; total: number }> {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  let headers: string[] | null = null;
  let skipped = false;
  let rows = 0;
  let total = 0;
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
    const customId = String(row["Custom ID"] ?? row.custom_id ?? "").trim();
    const country = String(row.Country ?? row.country ?? "").trim();
    if (!customIds.has(customId)) continue;
    if (options.country && country !== options.country) continue;
    const revenue = Number(row[options.revenueColumn ?? "Partner Revenue"] ?? row.partner_revenue ?? row.partner_revenue_usd ?? 0);
    if (!Number.isFinite(revenue)) continue;
    rows += 1;
    total += revenue;
  }
  return { rows, total };
}

async function main(): Promise<void> {
  const sample1 = await loadCustomIds(path.resolve("저작", "1.YouTube_kwangsoomedia_pla_M_20260101_20260131_rev_views_by_asset_v1-0.csv"));
  const sample2 = await loadCustomIds(path.resolve("저작", "2.YouTube_kwangsoomedia_pla_M_20260101_ADJ_asset_raw_v1-1.csv"));
  const sample3 = await loadCustomIds(path.resolve("저작", "3.YouTube_kwangsoomedia_pla_M_20260101_20260131_red_pubs_rawdata_asset_v1-1.csv"), { skipSummary: true });
  const union = new Set([...sample1, ...sample2, ...sample3]);
  const candidates = [
    ["sample1", sample1],
    ["sample2", sample2],
    ["sample3", sample3],
    ["union", union],
  ] as const;
  const files = [
    ["ad", path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_asset_raw_v1-1.csv"), {}],
    ["adj", path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_ADJ_asset_raw_v1-1.csv"), {}],
    ["red", path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_20260531_red_label_rawdata_asset_v1-1.csv"), { skipSummary: true }],
    ["audio", path.resolve("202605cms", "YouTube_kwangsoomedia_Audio_Tier_20260501_Financial_Detail_v1-0.csv"), {}],
  ] as const;
  console.log(`customIds sample1=${sample1.size} sample2=${sample2.size} sample3=${sample3.size} union=${union.size}`);
  for (const [setName, ids] of candidates) {
    for (const [fileName, filePath, options] of files) {
      const result = await sumByCustomIds(filePath, ids, { ...options, country: "KR" });
      console.log(`${setName}\t${fileName}\trows=${result.rows}\ttotal=${result.total.toFixed(12)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
