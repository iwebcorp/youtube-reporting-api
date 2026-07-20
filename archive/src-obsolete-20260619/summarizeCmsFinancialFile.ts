import * as fs from "fs";
import { pathToFileURL } from "url";

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

async function run(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: summarizeCmsFinancialFile <csvPath>");
  }

  const text = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const headerLine = lines[0] === "Asset Summary" ? lines[1] : lines[0];
  if (!headerLine) {
    throw new Error(`Missing header: ${filePath}`);
  }

  const headers = parseCsvLine(headerLine.replace(/^\uFEFF/, ""));
  const revenueIndex = headers.findIndex((header) => header === "Partner Revenue");
  const adjustmentIndex = headers.findIndex((header) => header === "Adjustment Type");
  const rowStart = lines[0] === "Asset Summary" ? 2 : 1;
  const byAdjustment = new Map<string, number>();
  let total = 0;
  let rows = 0;

  for (const line of lines.slice(rowStart)) {
    const values = parseCsvLine(line);
    if (values.length !== headers.length) {
      continue;
    }

    const revenue = Number(values[revenueIndex] ?? "0");
    const adjustmentType = values[adjustmentIndex] ?? "";
    total += Number.isFinite(revenue) ? revenue : 0;
    rows += 1;
    byAdjustment.set(adjustmentType, (byAdjustment.get(adjustmentType) ?? 0) + revenue);
  }

  console.log(`file=${filePath}`);
  console.log(`rows=${rows}`);
  console.log(`total=${total.toFixed(12)}`);
  for (const [adjustmentType, value] of [...byAdjustment.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${adjustmentType || "<empty>"}=${value.toFixed(12)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error("[SummarizeCmsFinancialFile] Failed.", error);
    process.exitCode = 1;
  });
}
