import * as fs from "fs";
import * as path from "path";

interface AudioRow {
  resourceId: string;
  title: string;
  artist: string;
  rightsControllerWorkId: string;
  rightType: string;
  allocatedAmount: number;
}

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
    rows.push([...values.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((entry) => entry[1]));
  }
  return rows;
}

function toNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAudioRows(probeDir: string): AudioRow[] {
  const sharedStringsXml = fs.readFileSync(path.join(probeDir, "xl/sharedStrings.xml"), "utf-8");
  const sheetXml = fs.readFileSync(path.join(probeDir, "xl/worksheets/sheet1.xml"), "utf-8");
  return parseRows(sheetXml, loadSharedStrings(sharedStringsXml))
    .filter((row) => row[0] === "SR02")
    .map((row) => ({
      resourceId: row[2] ?? "",
      title: row[3] ?? "",
      artist: row[4] ?? "",
      rightsControllerWorkId: row[13] ?? "",
      rightType: row[15] ?? "",
      allocatedAmount: toNumber(row[17]),
    }));
}

function shouldExcludeBase(row: AudioRow): boolean {
  return /live|official/i.test(row.title);
}

function groupRows(rows: AudioRow[]) {
  const grouped = new Map<string, { key: string; title: string; artist: string; amount: number; rowCount: number }>();
  for (const row of rows) {
    const key = `${row.rightsControllerWorkId}|${row.title}`;
    const entry =
      grouped.get(key) ??
      { key, title: row.title, artist: row.artist, amount: 0, rowCount: 0 };
    entry.amount += row.allocatedAmount;
    entry.rowCount += 1;
    grouped.set(key, entry);
  }
  return [...grouped.values()];
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/audio_service");
  const target = Number(process.argv[3] ?? "2.685787862");
  const tolerance = Number(process.argv[4] ?? "0.01");
  const rows = parseAudioRows(probeDir);
  const baseRows = rows.filter((row) => !shouldExcludeBase(row));
  const baseTotal = baseRows.reduce((sum, row) => sum + row.allocatedAmount, 0);
  const grouped = groupRows(baseRows);
  const diffNeeded = baseTotal - target;
  const candidates = grouped.filter((row) => row.amount <= Math.abs(diffNeeded) + tolerance).sort((a, b) => a.amount - b.amount);

  console.log(`[SearchAudioServiceFineTune] baseTotal=${baseTotal.toFixed(12)} target=${target.toFixed(12)} diff=${(baseTotal - target).toFixed(12)}`);
  for (const candidate of candidates) {
    const total = baseTotal - candidate.amount;
    const diff = Math.abs(total - target);
    if (diff <= tolerance) {
      console.log(`exclude\t${candidate.key}\t${candidate.amount.toFixed(12)}\t${total.toFixed(12)}\t${diff.toFixed(12)}\t${candidate.title}`);
    }
  }
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const total = baseTotal - candidates[i]!.amount - candidates[j]!.amount;
      const diff = Math.abs(total - target);
      if (diff <= tolerance) {
        console.log(
          `exclude2\t${candidates[i]!.key}+${candidates[j]!.key}\t${total.toFixed(12)}\t${diff.toFixed(12)}`,
        );
      }
    }
  }
}

run();
