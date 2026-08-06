import * as fs from "fs";
import * as path from "path";
import type { AssetCategory, AssetMetadata, CsvRow } from "./types.js";
import { parseCsvRows } from "./parsers.js";
import { clean, findFirstValue, loadJsonRecord, withMetadataFallbacks } from "./utils.js";

export class AssetMetadataRepository {
  private readonly neighboringAssets = new Set<string>();
  private readonly publishingAssets = new Set<string>();
  private readonly neighboringCustomIds = new Set<string>();
  private readonly publishingCustomIds = new Set<string>();
  private readonly metadataMap = new Map<string, AssetMetadata>();

  public async initialize(options: {
    neighboringDir: string;
    publishingDir: string;
    cacheFile: string;
    forceRefresh?: boolean;
  }): Promise<void> {
    console.log("[Metadata] Initializing asset metadata repository");
    if (!options.forceRefresh) {
      this.loadCache(options.cacheFile);
    }
    const shouldRefresh = this.shouldRefreshFromSources(
      options.cacheFile,
      [options.neighboringDir, options.publishingDir],
    ) || options.forceRefresh === true;

    if (shouldRefresh) {
      this.neighboringAssets.clear();
      this.publishingAssets.clear();
      this.neighboringCustomIds.clear();
      this.publishingCustomIds.clear();
      this.metadataMap.clear();
      const neighboringDir = path.resolve(options.neighboringDir);
      const publishingDir = path.resolve(options.publishingDir);
      if (neighboringDir === publishingDir) {
        await this.scanDirectory(neighboringDir);
      } else {
        await this.scanDirectory(neighboringDir, "Neighboring");
        await this.scanDirectory(publishingDir, "Publishing");
      }
      this.saveCache(options.cacheFile);
    } else {
      console.log("[Metadata] Cache is newer than source files. Skipping source rescan.");
    }

    console.log(
      `[Metadata] Loaded ${this.metadataMap.size} assets. neighboring=${this.neighboringAssets.size}, publishing=${this.publishingAssets.size}`,
    );
  }

  public classify(assetId: string): AssetCategory {
    const metadata = this.metadataMap.get(assetId);
    if (metadata?.sourceCategory === "Publishing") return "Publishing";
    if (metadata?.sourceCategory === "Neighboring") return "Neighboring";

    if (this.publishingAssets.has(assetId)) return "Publishing";
    if (this.neighboringAssets.has(assetId)) return "Neighboring";

    if (metadata) {
      if (metadata.iswc || metadata.hfa || metadata.writers !== "Unidentified Writers") {
        return "Publishing";
      }
      if (metadata.isrc || metadata.upc || metadata.artist !== "Various Artists") {
        return "Neighboring";
      }
    }

    return "Unknown";
  }

  public classifyCustomId(customId: string): AssetCategory {
    const normalized = clean(customId);
    if (!normalized) {
      return "Unknown";
    }
    if (this.publishingCustomIds.has(normalized)) {
      return "Publishing";
    }
    if (this.neighboringCustomIds.has(normalized)) {
      return "Neighboring";
    }
    return "Unknown";
  }

  public getMetadata(assetId: string): AssetMetadata {
    return this.metadataMap.get(assetId) ?? withMetadataFallbacks({ assetId });
  }

  private loadCache(cacheFile: string): void {
    const cached = loadJsonRecord<AssetMetadata>(cacheFile);
    for (const [assetId, metadata] of Object.entries(cached)) {
      const normalized = withMetadataFallbacks({ ...metadata, assetId });
      this.metadataMap.set(assetId, normalized);
      if (normalized.sourceCategory === "Publishing") {
        this.publishingAssets.add(assetId);
        if (normalized.customId) {
          this.publishingCustomIds.add(normalized.customId);
        }
      }
      if (normalized.sourceCategory === "Neighboring") {
        this.neighboringAssets.add(assetId);
        if (normalized.customId) {
          this.neighboringCustomIds.add(normalized.customId);
        }
      }
      if (normalized.iswc || normalized.hfa || (normalized.writers && normalized.writers !== "Unidentified Writers" && !normalized.isrc)) {
        this.publishingAssets.add(assetId);
      }
      if (normalized.isrc || normalized.upc) {
        this.neighboringAssets.add(assetId);
      }
    }
    console.log(`[Metadata] Cache loaded from ${cacheFile}. assets=${Object.keys(cached).length}`);
  }

  private saveCache(cacheFile: string): void {
    const serialized: Record<string, AssetMetadata> = {};
    for (const [assetId, metadata] of this.metadataMap.entries()) {
      serialized[assetId] = metadata;
    }
    fs.writeFileSync(cacheFile, JSON.stringify(serialized, null, 2), "utf-8");
    console.log(`[Metadata] Cache saved to ${cacheFile}`);
  }

  private shouldRefreshFromSources(cacheFile: string, directories: string[]): boolean {
    if (!fs.existsSync(cacheFile)) {
      return true;
    }

    if (this.hasSuspiciousEncodingInCache()) {
      console.warn("[Metadata] Suspicious mojibake detected in cache. Refreshing from source files.");
      return true;
    }

    const cacheStat = fs.statSync(cacheFile);
    for (const directoryPath of directories) {
      if (!fs.existsSync(directoryPath)) {
        continue;
      }

      const files = fs
        .readdirSync(directoryPath)
        .filter((fileName) => fileName.endsWith(".csv") || fileName.endsWith(".txt"))
        .map((fileName) => path.join(directoryPath, fileName));

      for (const filePath of files) {
        const fileStat = fs.statSync(filePath);
        if (fileStat.mtimeMs > cacheStat.mtimeMs) {
          return true;
        }
      }
    }

    return false;
  }

  private hasSuspiciousEncodingInCache(): boolean {
    let inspected = 0;
    for (const metadata of this.metadataMap.values()) {
      const probe = [metadata.title, metadata.artist, metadata.album, metadata.label, metadata.writers].join(" ");
      if (probe.includes("�") || probe.includes("\uFFFD")) {
        return true;
      }
      inspected += 1;
      if (inspected >= 200) {
        break;
      }
    }
    return false;
  }

  private async scanDirectory(directoryPath: string, category?: AssetCategory): Promise<void> {
    if (!fs.existsSync(directoryPath)) {
      const categoryLabel = category ?? "shared metadata";
      console.warn(`[Metadata] Skipping missing ${categoryLabel} directory: ${directoryPath}`);
      return;
    }

    const files = fs
      .readdirSync(directoryPath)
      .filter((fileName) => fileName.endsWith(".csv") || fileName.endsWith(".txt"))
      .map((fileName) => path.join(directoryPath, fileName));

    console.log(`[Metadata] Scanning ${files.length} files in ${directoryPath}`);
    for (const filePath of files) {
      await this.scanMetadataFile(filePath, category);
    }
  }

  private async scanMetadataFile(filePath: string, category?: AssetCategory): Promise<void> {
    const isTabSeparated = filePath.endsWith(".txt") || path.basename(filePath).includes("DSR");
    const rows = await parseCsvRows(filePath, {
      delimiter: isTabSeparated ? "\t" : ",",
      encoding: "auto",
    });

    let processedCount = 0;
    for (const row of rows) {
      const assetId = findFirstValue(row, ["asset id"]);
      if (!assetId) continue;

      processedCount += 1;
      if (category === "Neighboring") {
        this.neighboringAssets.add(assetId);
      } else if (category === "Publishing") {
        this.publishingAssets.add(assetId);
      }

      const merged = this.mergeMetadata(assetId, row, category);
      this.metadataMap.set(assetId, merged);
      if (category === "Neighboring" && merged.customId) {
        this.neighboringCustomIds.add(merged.customId);
      } else if (category === "Publishing" && merged.customId) {
        this.publishingCustomIds.add(merged.customId);
      }
    }

    console.log(`[Metadata] ${path.basename(filePath)} processed rows=${processedCount}`);
  }

  private mergeMetadata(assetId: string, row: CsvRow, category?: AssetCategory): AssetMetadata {
    const existing = this.metadataMap.get(assetId) ?? withMetadataFallbacks({ assetId });
    const sourceCategory =
      existing.sourceCategory === "Publishing" || category === "Publishing"
        ? "Publishing"
        : existing.sourceCategory === "Neighboring" || category === "Neighboring"
          ? "Neighboring"
          : undefined;

    return withMetadataFallbacks({
      assetId,
      ...(sourceCategory ? { sourceCategory } : {}),
      title: this.pick(existing.title, row, ["asset title", "title"]),
      customId: this.pick(existing.customId, row, ["custom id"]),
      isrc: this.pick(existing.isrc, row, ["isrc"]),
      iswc: this.pick(existing.iswc, row, ["iswc"]),
      hfa: this.pick(existing.hfa, row, ["hfa song code", "hfa"]),
      upc: this.pick(existing.upc, row, ["upc"]),
      writers: this.pick(existing.writers, row, ["writers", "writer", "composer", "author", "composerauthor"]),
      artist: this.pick(existing.artist, row, ["artist", "artists", "display artist name", "displayartistname"]),
      album: this.pick(existing.album, row, ["album"]),
      label: this.pick(existing.label, row, ["label"]),
      assetType: this.pick(existing.assetType, row, ["asset type"]),
      musicClaimType: this.pick(existing.musicClaimType, row, ["music claim type", "claim type"]),
      compositionRightType: this.pick(
        existing.compositionRightType,
        row,
        ["composition right type", "right type"],
      ),
      channelId: this.pick(existing.channelId, row, ["asset channel id", "channel id"]),
    });
  }

  private pick(existingValue: string, row: CsvRow, aliases: string[]): string {
    const discovered = findFirstValue(row, aliases);
    return discovered || existingValue;
  }
}
