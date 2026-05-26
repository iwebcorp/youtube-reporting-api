import * as fs from "fs";
import * as path from "path";

interface AudioRow {
  resourceId: string;
  title: string;
  artist: string;
  isrc: string;
  workId: string;
  writers: string;
  usages: number;
  allocatedUsages: number;
  contentCategory: string;
  rightsControllerWorkId: string;
  rightShare: string;
  rightType: string;
  allocatedNetRevenue: number;
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
    const ordered = [...values.entries()].sort((left, right) => left[0].localeCompare(right[0])).map((entry) => entry[1]);
    rows.push(ordered);
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
      isrc: row[5] ?? "",
      workId: row[6] ?? "",
      writers: row[8] ?? "",
      usages: toNumber(row[9]),
      allocatedUsages: toNumber(row[10]),
      contentCategory: row[12] ?? "",
      rightsControllerWorkId: row[13] ?? "",
      rightShare: row[14] ?? "",
      rightType: row[15] ?? "",
      allocatedNetRevenue: toNumber(row[16]),
      allocatedAmount: toNumber(row[17]),
    }));
}

function matchesPattern(row: AudioRow, pattern: string): boolean {
  const title = row.title;
  switch (pattern) {
    case "inst":
      return /\binst\b|\(inst\)/i.test(title);
    case "mr":
      return /\bmr\b|\(mr\)/i.test(title);
    case "live_or_official":
      return /live|official/i.test(title);
    case "mechanical":
      return row.rightType === "MechanicalRight";
    case "performing":
      return row.rightType === "PerformingRight";
    case "partial_share":
      return row.rightShare !== "1";
    case "non_music":
      return row.contentCategory !== "Music";
    case "zero_net":
      return row.allocatedNetRevenue === 0;
    default:
      return false;
  }
}

function run(): void {
  const probeDir = path.resolve(process.cwd(), process.argv[2] ?? "scratch/xlsx_probe/audio_service");
  const target = Number(process.argv[3] ?? "2.685787862");
  const rows = parseAudioRows(probeDir);
  const total = rows.reduce((sum, row) => sum + row.allocatedAmount, 0);
  const patterns = ["inst", "mr", "live_or_official", "mechanical", "performing", "partial_share", "non_music", "zero_net"];
  const combos: string[][] = [[]];
  for (const pattern of patterns) combos.push([pattern]);
  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      combos.push([patterns[i]!, patterns[j]!]);
    }
  }
  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      for (let k = j + 1; k < patterns.length; k += 1) {
        combos.push([patterns[i]!, patterns[j]!, patterns[k]!]);
      }
    }
  }

  const results = combos
    .map((combo) => {
      const filtered = rows.filter((row) => !combo.some((pattern) => matchesPattern(row, pattern)));
      const filteredTotal = filtered.reduce((sum, row) => sum + row.allocatedAmount, 0);
      return {
        combo,
        total: filteredTotal,
        excluded: total - filteredTotal,
        diff: Math.abs(filteredTotal - target),
      };
    })
    .sort((left, right) => left.diff - right.diff)
    .slice(0, 30);

  console.log(`[SearchAudioServiceRules] total=${total.toFixed(12)} target=${target.toFixed(12)}`);
  for (const result of results) {
    console.log(`${result.combo.join("+") || "(none)"}\ttotal=${result.total.toFixed(12)}\texcluded=${result.excluded.toFixed(12)}\tdiff=${result.diff.toFixed(12)}`);
  }
}

run();
