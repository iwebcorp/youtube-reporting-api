import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

type Row = Record<string, string>;
type Group = { key: string; rows: number; total: number; sample: Row };

const TARGETS = {
  ad: 2427.094717,
  adj: 1.47069,
  red: 2113.6699,
  audio: 2.626366,
};

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

async function readRows(filePath: string, options: { skipSummary?: boolean } = {}): Promise<Row[]> {
  const rows: Row[] = [];
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
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }
  return rows;
}

function value(row: Row, names: string[]): string {
  for (const name of names) {
    const found = row[name];
    if (found !== undefined) return String(found).trim();
  }
  return "";
}

function revenue(row: Row): number {
  return Number(value(row, ["Partner Revenue", "partner_revenue", "partner_revenue_usd"])) || 0;
}

function groupBy(rows: Row[], keyFn: (row: Row) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const country = value(row, ["Country", "country"]);
    if (country !== "KR") continue;
    const key = keyFn(row);
    const amount = revenue(row);
    const group = groups.get(key) ?? { key, rows: 0, total: 0, sample: row };
    group.rows += 1;
    group.total += amount;
    groups.set(key, group);
  }
  return [...groups.values()];
}

function printClosest(label: string, groups: Group[], target: number, limit = 20): void {
  console.log(`\n## ${label} target=${target}`);
  const sorted = groups
    .map((group) => ({ ...group, diff: group.total - target }))
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))
    .slice(0, limit);
  for (const group of sorted) {
    console.log(
      `${group.key}\trows=${group.rows}\ttotal=${group.total.toFixed(12)}\tdiff=${group.diff.toFixed(12)}`,
    );
  }
}

function keyFns(): Array<[string, (row: Row) => string]> {
  return [
    ["assetType", (row) => value(row, ["Asset Type", "asset_type"])],
    ["claimType", (row) => value(row, ["Claim Type", "claim_type"])],
    ["contentType", (row) => value(row, ["Content Type", "content_type"])],
    ["origin", (row) => value(row, ["Claim Origin", "claim_origin"])],
    ["prefix3", (row) => value(row, ["Custom ID", "custom_id"]).slice(0, 3)],
    ["prefix6", (row) => value(row, ["Custom ID", "custom_id"]).slice(0, 6)],
    ["assetType+claimType", (row) => `${value(row, ["Asset Type", "asset_type"])}|${value(row, ["Claim Type", "claim_type"])}`],
    ["assetType+contentType", (row) => `${value(row, ["Asset Type", "asset_type"])}|${value(row, ["Content Type", "content_type"])}`],
    ["claimType+contentType", (row) => `${value(row, ["Claim Type", "claim_type"])}|${value(row, ["Content Type", "content_type"])}`],
    ["assetType+claimType+contentType", (row) => `${value(row, ["Asset Type", "asset_type"])}|${value(row, ["Claim Type", "claim_type"])}|${value(row, ["Content Type", "content_type"])}`],
    ["assetType+claimType+contentType+prefix3", (row) => `${value(row, ["Asset Type", "asset_type"])}|${value(row, ["Claim Type", "claim_type"])}|${value(row, ["Content Type", "content_type"])}|${value(row, ["Custom ID", "custom_id"]).slice(0, 3)}`],
    ["assetId", (row) => value(row, ["Asset ID", "asset_id"])],
    ["customId", (row) => value(row, ["Custom ID", "custom_id"])],
    ["title", (row) => value(row, ["Asset Title", "asset_title"])],
  ];
}

async function analyze(label: string, filePath: string, target: number, options?: { skipSummary?: boolean }): Promise<void> {
  const rows = await readRows(filePath, options);
  console.log(`\nFILE ${label} rows=${rows.length} ${filePath}`);
  for (const [keyName, keyFn] of keyFns()) {
    printClosest(`${label} ${keyName}`, groupBy(rows, keyFn), target, 8);
  }
}

async function main(): Promise<void> {
  await analyze("ad asset", "202605cms/YouTube_kwangsoomedia_M_20260501_asset_raw_v1-1.csv", TARGETS.ad);
  await analyze("ad claim", "202605cms/YouTube_kwangsoomedia_M_20260501_claim_raw_v1-1.csv", TARGETS.ad);
  await analyze("adj asset", "202605cms/YouTube_kwangsoomedia_M_20260501_ADJ_asset_raw_v1-1.csv", TARGETS.adj);
  await analyze("adj claim", "202605cms/YouTube_kwangsoomedia_M_20260501_ADJ_claim_raw_v1-1.csv", TARGETS.adj);
  await analyze("red asset", "202605cms/YouTube_kwangsoomedia_M_20260501_20260531_red_label_rawdata_asset_v1-1.csv", TARGETS.red, { skipSummary: true });
  await analyze("audio detail", "202605cms/YouTube_kwangsoomedia_Audio_Tier_20260501_Financial_Detail_v1-0.csv", TARGETS.audio);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
