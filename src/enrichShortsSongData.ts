// 곡별 Shorts 사용량 파일에 YouTube 자산 메타데이터를 보강한다.
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { pathToFileURL } from "url";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import { csvEscape, ensureDirectory } from "./reporting/utils.js";

interface AssetMetadataOverride {
  title: string;
  customId: string;
  isrc: string;
}

function getRequiredArg(argv: string[], name: string): string {
  const prefix = `--${name}=`;
  const value = argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`[ShortsEnrich] Missing required option: ${prefix}<path>`);
  }
  return path.resolve(value);
}

function isGzipFile(filePath: string): boolean {
  const handle = fs.openSync(filePath, "r");
  try {
    const signature = Buffer.alloc(2);
    return fs.readSync(handle, signature, 0, signature.length, 0) === 2
      && signature[0] === 0x1f
      && signature[1] === 0x8b;
  } finally {
    fs.closeSync(handle);
  }
}

async function loadMetadata(filePath: string): Promise<Map<string, AssetMetadataOverride>> {
  const source = fs.createReadStream(filePath);
  const input = isGzipFile(filePath) ? source.pipe(zlib.createGunzip()) : source;
  const parser = input.pipe(parse({ columns: true, bom: true, trim: true, relax_column_count: true }));
  const metadata = new Map<string, AssetMetadataOverride>();

  for await (const row of parser) {
    const assetId = String(row.asset_id ?? "").trim();
    if (!assetId) continue;
    metadata.set(assetId, {
      title: String(row.asset_title ?? "").trim(),
      customId: String(row.custom_id ?? "").trim(),
      isrc: [row.display_isrc, row.your_isrc, row.other_isrc]
        .map((value) => String(value ?? "").trim())
        .find(Boolean) ?? "",
    });
  }

  return metadata;
}

async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const inputFile = getRequiredArg(argv, "inputFile");
  const metadataFile = getRequiredArg(argv, "assetMetadataFile");
  const outputFile = getRequiredArg(argv, "outputFile");

  if (inputFile === outputFile) {
    throw new Error("[ShortsEnrich] outputFile must differ from inputFile.");
  }

  console.log(`[ShortsEnrich] Loading metadata: ${metadataFile}`);
  const metadata = await loadMetadata(metadataFile);
  const parser = fs
    .createReadStream(inputFile)
    .pipe(iconv.decodeStream("cp949"))
    .pipe(parse({
      columns: (columns: string[]) => {
        header = columns;
        return columns;
      },
      bom: true,
      trim: true,
      relax_column_count: true,
    }));

  let header: string[] = [];
  const textColumns = new Set([
    "Category",
    "Country",
    "Asset ID",
    "Asset Title",
    "Custom ID",
    "ISRC",
    "ISWC",
    "Writers",
    "Video ID",
  ]);
  const lines: string[] = [];
  const matchedAssets = new Set<string>();
  let rowCount = 0;
  let titleFilled = 0;
  let customIdFilled = 0;
  let isrcFilled = 0;

  for await (const row of parser) {
    if (lines.length === 0) {
      if (!header.includes("Asset ID")) {
        throw new Error("[ShortsEnrich] Input file does not contain an Asset ID column.");
      }
      lines.push(header.join(","));
    }
    rowCount += 1;
    const assetId = String(row["Asset ID"] ?? "").trim();
    const override = metadata.get(assetId);
    if (override) {
      matchedAssets.add(assetId);
      if (override.title) {
        if (!row["Asset Title"] || row["Asset Title"] === "Untitled Asset") titleFilled += 1;
        row["Asset Title"] = override.title;
      }
      if (override.customId) {
        if (!row["Custom ID"]) customIdFilled += 1;
        row["Custom ID"] = override.customId;
      }
      if (override.isrc) {
        if (!row.ISRC) isrcFilled += 1;
        row.ISRC = override.isrc;
      }
    }

    lines.push(
      header
        .map((column) => textColumns.has(column) ? csvEscape(row[column]) : String(row[column] ?? "").trim())
        .join(","),
    );
  }

  if (lines.length === 0 && header.length > 0) {
    lines.push(header.join(","));
  }

  ensureDirectory(path.dirname(outputFile));
  fs.writeFileSync(outputFile, iconv.encode(`${lines.join("\n")}\n`, "cp949"));
  console.log(
    `[ShortsEnrich] Wrote ${outputFile}. rows=${rowCount} matchedAssets=${matchedAssets.size} `
      + `titleFilled=${titleFilled} customIdFilled=${customIdFilled} isrcFilled=${isrcFilled}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error("[ShortsEnrich] Failed.", error);
    process.exitCode = 1;
  });
}
