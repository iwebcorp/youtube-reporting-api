import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

type Totals = {
  sum: number;
  rows: number;
  labels: Set<string>;
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
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

async function main() {
  const targetPath =
    process.argv[2] ??
    path.join(
      process.cwd(),
      "from _cms",
      "YouTube_kwangsoomedia_M_20260401_asset_raw_v1-1.csv",
    );

  const stream = fs.createReadStream(targetPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] | null = null;
  const byTitle = new Map<string, Totals>();

  for await (const line of rl) {
    if (!line) {
      continue;
    }

    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }

    const values = parseCsvLine(line);
    if (values.length !== headers.length) {
      continue;
    }

    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const title = row["Asset Title"];
    if (!title) {
      continue;
    }

    const partnerRevenue = Number(row["Partner Revenue"] || "0");
    const label = row["Label"] || "";
    const bucket = byTitle.get(title) ?? { sum: 0, rows: 0, labels: new Set<string>() };

    bucket.sum += Number.isFinite(partnerRevenue) ? partnerRevenue : 0;
    bucket.rows += 1;
    if (label) {
      bucket.labels.add(label);
    }

    byTitle.set(title, bucket);
  }

  const topTitles = [...byTitle.entries()]
    .map(([title, totals]) => ({
      title,
      sum: totals.sum,
      rows: totals.rows,
      labels: [...totals.labels].sort(),
    }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, 60);

  process.stdout.write(`${JSON.stringify(topTitles, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
