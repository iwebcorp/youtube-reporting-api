import * as fs from "fs";
import * as path from "path";

function loadSharedStrings(sharedStringsXml: string): string[] {
  return Array.from(sharedStringsXml.matchAll(/<t[^>]*>(.*?)<\/t>/gs), (match) =>
    (match[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

function parseRows(sheetXml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row r="(\d+)"[^>]*>(.*?)<\/row>/gs)) {
    const rowXml = rowMatch[2] ?? "";
    const values = new Map<string, string>();
    for (const cell of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>(.*?)<\/v>)?.*?<\/c>/gs)) {
      const column = cell[1] ?? "";
      const attrs = cell[2] ?? "";
      const rawValue = cell[3] ?? "";
      const sharedMatch = attrs.match(/\bt="([^"]+)"/);
      const resolved =
        sharedMatch?.[1] === "s" && /^\d+$/.test(rawValue)
          ? (sharedStrings[Number(rawValue)] ?? "")
          : rawValue;
      values.set(column, resolved);
    }

    const ordered: string[] = [];
    for (const [column, value] of [...values.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
      void column;
      ordered.push(value);
    }
    rows.push(ordered);
  }
  return rows;
}

function toNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/audio_service");
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  const rows = parseRows(sheetXml, loadSharedStrings(sharedStringsXml));

  const gsy09Rows = rows.filter((row) => row[0] === "GSY09");
  const sr02Rows = rows.filter((row) => row[0] === "SR02");

  const gsy09ByRight = new Map<string, number>();
  for (const row of gsy09Rows) {
    const rightType = row[9] ?? "";
    const amount = toNumber(row[6]);
    gsy09ByRight.set(rightType, (gsy09ByRight.get(rightType) ?? 0) + amount);
  }

  const sr02ByRight = new Map<string, number>();
  for (const row of sr02Rows) {
    const rightType = row[15] ?? "";
    const amount = toNumber(row[17]);
    sr02ByRight.set(rightType, (sr02ByRight.get(rightType) ?? 0) + amount);
  }

  console.log(
    JSON.stringify(
      {
        sampleGsy09Row: gsy09Rows[0] ?? null,
        sampleSr02Row: sr02Rows[0] ?? null,
        gsy09RowCount: gsy09Rows.length,
        gsy09TotalAllocatedAmount: gsy09Rows.reduce((sum, row) => sum + toNumber(row[6]), 0),
        gsy09ByRight: Object.fromEntries(gsy09ByRight),
        sr02RowCount: sr02Rows.length,
        sr02TotalAllocatedAmount: sr02Rows.reduce((sum, row) => sum + toNumber(row[17]), 0),
        sr02ByRight: Object.fromEntries(sr02ByRight),
      },
      null,
      2,
    ),
  );
}

run();
