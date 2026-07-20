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

function loadRelatedIds(): Set<string> {
  const cache = JSON.parse(fs.readFileSync(path.resolve("asset_relationship_cache.json"), "utf8")) as Record<string, any>;
  const ids = new Set<string>();
  for (const [compositionId, entry] of Object.entries(cache)) {
    ids.add(compositionId);
    for (const related of entry.relatedAssetIds ?? []) ids.add(String(related));
    for (const relation of entry.allRelations ?? []) {
      for (const key of ["sourceAssetId", "destinationAssetId", "parentAssetId", "childAssetId"]) {
        const value = String(relation[key] ?? "").trim();
        if (value) ids.add(value);
      }
    }
  }
  return ids;
}

async function sumFile(
  label: string,
  filePath: string,
  ids: Set<string>,
  options: { skipSummary?: boolean; revenueColumn?: string } = {},
): Promise<void> {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
  let headers: string[] | null = null;
  let skipped = false;
  let rows = 0;
  let total = 0;
  let matchedIds = new Set<string>();
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
    if (country !== "KR") continue;
    const assetId = String(row["Asset ID"] ?? row.asset_id ?? "").trim();
    if (!ids.has(assetId)) continue;
    const revenue = Number(row[options.revenueColumn ?? "Partner Revenue"] ?? row.partner_revenue ?? row.partner_revenue_usd ?? 0);
    if (!Number.isFinite(revenue)) continue;
    rows += 1;
    total += revenue;
    matchedIds.add(assetId);
  }
  console.log(`${label}: rows=${rows} assetIds=${matchedIds.size} total=${total.toFixed(12)}`);
}

async function main(): Promise<void> {
  const ids = loadRelatedIds();
  const cacheCount = Object.keys(JSON.parse(fs.readFileSync(path.resolve("asset_relationship_cache.json"), "utf8"))).length;
  console.log(`cache=${cacheCount} relatedIds=${ids.size}`);
  await sumFile("ad", path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_asset_raw_v1-1.csv"), ids);
  await sumFile("adj", path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_ADJ_asset_raw_v1-1.csv"), ids);
  await sumFile("red", path.resolve("202605cms", "YouTube_kwangsoomedia_M_20260501_20260531_red_label_rawdata_asset_v1-1.csv"), ids, { skipSummary: true });
  await sumFile("audio", path.resolve("202605cms", "YouTube_kwangsoomedia_Audio_Tier_20260501_Financial_Detail_v1-0.csv"), ids);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
