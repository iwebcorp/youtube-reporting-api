// 월별 API 자산 보고서에서만 메타데이터를 구성하는 저장소
import * as fs from "fs";
import * as path from "path";
import type { AssetCategory, AssetMetadata, CsvRow } from "./types.js";
import { contentIdCustomIdFileName } from "../monthlyReadiness.js";
import { parseCsvRows } from "./parsers.js";
import { clean, findFirstValue, normalizeHeader, normalizeMetadata } from "./utils.js";

type MetadataProfile = "general" | "publishingComposition" | "publishingRecording";

export class AssetMetadataRepository {
  private readonly neighboringAssets = new Set<string>();
  private readonly publishingAssets = new Set<string>();
  private readonly neighboringCustomIds = new Set<string>();
  private readonly publishingCustomIds = new Set<string>();
  private readonly metadataMap = new Map<string, AssetMetadata>();
  // 곡(embedded composition) 자산별로 연결된 지분 자산의 Custom ID 목록
  private readonly compositionShareCustomIds = new Map<string, Set<string>>();

  public async initialize(options: {
    yearMonth: string;
    neighboringDir: string;
    publishingDir: string;
    forceRefresh?: boolean;
    includeContentIdCustomIds?: boolean;
  }): Promise<void> {
    console.log("[Metadata] Loading monthly API metadata sources");
    void options.forceRefresh;

    const neighboringDir = path.resolve(options.neighboringDir);
    const publishingDir = path.resolve(options.publishingDir);
    if (neighboringDir === publishingDir) {
      await this.scanDirectory(neighboringDir, options.yearMonth);
    } else {
      await this.scanDirectory(neighboringDir, options.yearMonth, "Neighboring");
      await this.scanDirectory(publishingDir, options.yearMonth, "Publishing");
    }
    this.clearAmbiguousCompositionCustomIds();
    if (options.includeContentIdCustomIds !== false) {
      await this.applyContentIdCustomIds(options.yearMonth, neighboringDir, publishingDir);
    }

    console.log(
      `[Metadata] Loaded ${this.metadataMap.size} assets from API files. neighboring=${this.neighboringAssets.size}, publishing=${this.publishingAssets.size}`,
    );
  }

  public classify(assetId: string): AssetCategory {
    const metadata = this.metadataMap.get(assetId);
    if (metadata?.sourceCategory === "Publishing") return "Publishing";
    if (metadata?.sourceCategory === "Neighboring") return "Neighboring";
    if (this.publishingAssets.has(assetId)) return "Publishing";
    if (this.neighboringAssets.has(assetId)) return "Neighboring";
    if (metadata?.iswc || metadata?.hfa || metadata?.writers) return "Publishing";
    if (metadata?.isrc || metadata?.upc || metadata?.artist) return "Neighboring";
    return "Unknown";
  }

  public classifyCustomId(customId: string): AssetCategory {
    const normalized = clean(customId);
    if (!normalized) return "Unknown";
    if (this.publishingCustomIds.has(normalized)) return "Publishing";
    if (this.neighboringCustomIds.has(normalized)) return "Neighboring";
    return "Unknown";
  }

  public getCompositionShareCustomIds(assetId: string): string[] {
    return [...(this.compositionShareCustomIds.get(assetId) ?? [])].sort();
  }

  // 지분 Custom ID가 여러 개인 곡은 어느 값이 맞는지 메타데이터만으로 정할 수 없으므로 비워 둔다.
  private clearAmbiguousCompositionCustomIds(): void {
    let clearedCount = 0;
    for (const [assetId, customIds] of this.compositionShareCustomIds) {
      const metadata = this.metadataMap.get(assetId);
      if (customIds.size < 2 || !metadata?.customId) continue;
      this.metadataMap.set(assetId, { ...metadata, customId: "" });
      clearedCount += 1;
    }
    console.log(`[Metadata] Cleared ${clearedCount} composition custom ids with multiple share custom ids`);
  }

  public getMetadata(assetId: string): AssetMetadata {
    return this.metadataMap.get(assetId) ?? normalizeMetadata({ assetId });
  }

  // a3 스냅샷에 Custom ID가 없는 자산만 같은 달 Content ID API 조회 결과로 채운다.
  private async applyContentIdCustomIds(yearMonth: string, neighboringDir: string, publishingDir: string): Promise<void> {
    const loadFile = async (directoryPath: string): Promise<Map<string, string>> => {
      const filePath = path.join(directoryPath, contentIdCustomIdFileName(yearMonth));
      const customIds = new Map<string, string>();
      if (!fs.existsSync(filePath)) {
        console.warn(`[Metadata] Content ID custom id file not found: ${filePath}`);
        return customIds;
      }
      for (const row of await parseCsvRows(filePath)) {
        const assetId = clean(row["asset_id"]);
        const customId = clean(row["custom_id"]);
        if (assetId && customId) customIds.set(assetId, customId);
      }
      return customIds;
    };

    const neighboringCustomIds = await loadFile(neighboringDir);
    const publishingCustomIds = neighboringDir === publishingDir ? new Map<string, string>() : await loadFile(publishingDir);
    let filledCount = 0;
    for (const assetId of new Set([...neighboringCustomIds.keys(), ...publishingCustomIds.keys()])) {
      const existing = this.metadataMap.get(assetId) ?? normalizeMetadata({ assetId });
      if (existing.customId) continue;
      const customId = existing.sourceCategory === "Publishing"
        ? publishingCustomIds.get(assetId) ?? neighboringCustomIds.get(assetId)
        : neighboringCustomIds.get(assetId) ?? publishingCustomIds.get(assetId);
      if (!customId) continue;
      this.metadataMap.set(assetId, { ...existing, customId });
      filledCount += 1;
    }
    console.log(`[Metadata] Filled ${filledCount} custom ids from Content ID API lookups`);
  }

  private async scanDirectory(directoryPath: string, yearMonth: string, category?: AssetCategory): Promise<void> {
    if (!fs.existsSync(directoryPath)) {
      throw new Error(`[Metadata] Missing monthly API metadata directory: ${directoryPath}`);
    }

    const files = fs
      .readdirSync(directoryPath)
      .filter((fileName) =>
        fileName.startsWith(`${yearMonth}_content_owner_asset_a3_`) && fileName.endsWith(".csv"),
      )
      .map((fileName) => path.join(directoryPath, fileName));
    if (files.length === 0) {
      throw new Error(`[Metadata] No ${yearMonth} API metadata file found: ${directoryPath}`);
    }

    for (const filePath of files) {
      await this.scanMetadataFile(filePath, category);
    }
  }

  private async scanMetadataFile(filePath: string, category?: AssetCategory): Promise<void> {
    const rows = await parseCsvRows(filePath, { encoding: "auto" });
    let processedCount = 0;

    for (const row of rows) {
      const candidates: Array<{ assetId: string; profile: MetadataProfile }> = category === "Publishing"
        ? [
            { assetId: findFirstValue(row, ["embedded composition asset id"]), profile: "publishingComposition" },
            { assetId: findFirstValue(row, ["composition share asset id"]), profile: "publishingComposition" },
            { assetId: findFirstValue(row, ["sr asset id"]), profile: "publishingRecording" },
          ]
        : [{ assetId: findFirstValue(row, ["asset id"]), profile: "general" }];

      const seen = new Set<string>();
      for (const candidate of candidates) {
        const assetId = clean(candidate.assetId);
        if (!assetId || seen.has(assetId)) continue;
        seen.add(assetId);
        processedCount += 1;
        this.recordAsset(assetId, row, category, candidate.profile);
      }
    }

    console.log(`[Metadata] ${path.basename(filePath)} processed assets=${processedCount}`);
  }

  private recordAsset(
    assetId: string,
    row: CsvRow,
    category: AssetCategory | undefined,
    profile: MetadataProfile,
  ): void {
    // PLA 메타데이터의 음원(sr_asset_id)은 곡이 들어간 일반 CMS 음원이므로 이미 확인된 분류를 덮지 않는다.
    const existingCategory = this.metadataMap.get(assetId)?.sourceCategory;
    if (profile === "publishingRecording" && existingCategory) category = existingCategory;

    if (category === "Neighboring") this.neighboringAssets.add(assetId);
    if (category === "Publishing") this.publishingAssets.add(assetId);

    if (profile === "publishingComposition") {
      const shareCustomId = findFirstValue(row, ["composition share custom id"]);
      if (shareCustomId) {
        const customIds = this.compositionShareCustomIds.get(assetId) ?? new Set<string>();
        customIds.add(shareCustomId);
        this.compositionShareCustomIds.set(assetId, customIds);
      }
    }

    const merged = this.mergeMetadata(assetId, row, category, profile);
    this.metadataMap.set(assetId, merged);
    if (category === "Neighboring" && merged.customId) this.neighboringCustomIds.add(merged.customId);
    if (category === "Publishing" && merged.customId) this.publishingCustomIds.add(merged.customId);
  }

  private mergeMetadata(
    assetId: string,
    row: CsvRow,
    category: AssetCategory | undefined,
    profile: MetadataProfile,
  ): AssetMetadata {
    const existing = this.metadataMap.get(assetId) ?? normalizeMetadata({ assetId });
    const sourceCategory = category ?? existing.sourceCategory;
    const composition = profile === "publishingComposition";
    const recording = profile === "publishingRecording";

    return normalizeMetadata({
      ...existing,
      assetId,
      ...(sourceCategory ? { sourceCategory } : {}),
      title: this.pick(existing.title, row, composition
        ? ["composition share title"]
        : recording ? ["sr title"] : ["asset title"]),
      customId: this.pick(existing.customId, row, composition
        ? ["composition share custom id"]
        : ["custom id"]),
      isrc: this.pick(existing.isrc, row, recording
        ? ["sr isrc"]
        : profile === "general" ? ["display isrc", "your isrc", "other isrc"] : []),
      iswc: this.pick(existing.iswc, row, composition ? ["composition share iswc"] : ["iswc"]),
      hfa: this.pick(existing.hfa, row, composition ? ["composition share hfa song code"] : ["hfa song code"]),
      upc: this.pick(existing.upc, row, profile === "general" ? ["upc"] : []),
      writers: this.pick(existing.writers, row, profile === "general" ? ["writers"] : ["composition share writers"]),
      artist: this.pick(existing.artist, row, recording ? ["sr artist"] : profile === "general" ? ["artist"] : []),
      album: this.pick(existing.album, row, profile === "general" ? ["album"] : []),
      label: this.pick(existing.label, row, profile === "general" ? ["label"] : []),
      assetType: this.pick(existing.assetType, row, profile === "general" ? ["asset type"] : []),
      musicClaimType: this.pick(existing.musicClaimType, row, ["music claim type", "claim type"]),
      compositionRightType: this.pick(existing.compositionRightType, row, ["composition right type"]),
      channelId: this.pick(existing.channelId, row, ["asset channel id", "channel id"]),
    });
  }

  private pick(existingValue: string, row: CsvRow, aliases: string[]): string {
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeader(alias);
      for (const [key, value] of Object.entries(row)) {
        if (normalizeHeader(key) !== normalizedAlias) continue;
        const discovered = clean(value);
        if (discovered) return discovered;
      }
    }
    return existingValue;
  }
}
