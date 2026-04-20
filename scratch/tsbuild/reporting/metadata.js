import * as fs from "fs";
import * as path from "path";
import { parseCsvRows } from "./parsers.js";
import { findFirstValue, loadJsonRecord, withMetadataFallbacks } from "./utils.js";
export class AssetMetadataRepository {
    constructor() {
        this.neighboringAssets = new Set();
        this.publishingAssets = new Set();
        this.metadataMap = new Map();
    }
    async initialize(options) {
        console.log("[Metadata] Initializing asset metadata repository");
        if (!options.forceRefresh) {
            this.loadCache(options.cacheFile);
        }
        const shouldRefresh = this.shouldRefreshFromSources(options.cacheFile, [options.neighboringDir, options.publishingDir]) || options.forceRefresh === true;
        if (shouldRefresh) {
            this.neighboringAssets.clear();
            this.publishingAssets.clear();
            this.metadataMap.clear();
            await this.scanDirectory(options.neighboringDir, "Neighboring");
            await this.scanDirectory(options.publishingDir, "Publishing");
            this.saveCache(options.cacheFile);
        }
        else {
            console.log("[Metadata] Cache is newer than source files. Skipping source rescan.");
        }
        console.log(`[Metadata] Loaded ${this.metadataMap.size} assets. neighboring=${this.neighboringAssets.size}, publishing=${this.publishingAssets.size}`);
    }
    classify(assetId) {
        const metadata = this.metadataMap.get(assetId);
        if (metadata?.sourceCategory === "Publishing")
            return "Publishing";
        if (metadata?.sourceCategory === "Neighboring")
            return "Neighboring";
        if (this.publishingAssets.has(assetId))
            return "Publishing";
        if (this.neighboringAssets.has(assetId))
            return "Neighboring";
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
    getMetadata(assetId) {
        return this.metadataMap.get(assetId) ?? withMetadataFallbacks({ assetId });
    }
    loadCache(cacheFile) {
        const cached = loadJsonRecord(cacheFile);
        for (const [assetId, metadata] of Object.entries(cached)) {
            const normalized = withMetadataFallbacks({ ...metadata, assetId });
            this.metadataMap.set(assetId, normalized);
            if (normalized.sourceCategory === "Publishing") {
                this.publishingAssets.add(assetId);
            }
            if (normalized.sourceCategory === "Neighboring") {
                this.neighboringAssets.add(assetId);
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
    saveCache(cacheFile) {
        const serialized = {};
        for (const [assetId, metadata] of this.metadataMap.entries()) {
            serialized[assetId] = metadata;
        }
        fs.writeFileSync(cacheFile, JSON.stringify(serialized, null, 2), "utf-8");
        console.log(`[Metadata] Cache saved to ${cacheFile}`);
    }
    shouldRefreshFromSources(cacheFile, directories) {
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
    hasSuspiciousEncodingInCache() {
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
    async scanDirectory(directoryPath, category) {
        if (!fs.existsSync(directoryPath)) {
            console.warn(`[Metadata] Skipping missing ${category} directory: ${directoryPath}`);
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
    async scanMetadataFile(filePath, category) {
        const isTabSeparated = filePath.endsWith(".txt") || path.basename(filePath).includes("DSR");
        const rows = await parseCsvRows(filePath, {
            delimiter: isTabSeparated ? "\t" : ",",
            encoding: "auto",
        });
        let processedCount = 0;
        for (const row of rows) {
            const assetId = findFirstValue(row, ["asset id"]);
            if (!assetId)
                continue;
            processedCount += 1;
            if (category === "Neighboring") {
                this.neighboringAssets.add(assetId);
            }
            else if (category === "Publishing") {
                this.publishingAssets.add(assetId);
            }
            const merged = this.mergeMetadata(assetId, row, category);
            this.metadataMap.set(assetId, merged);
        }
        console.log(`[Metadata] ${path.basename(filePath)} processed rows=${processedCount}`);
    }
    mergeMetadata(assetId, row, category) {
        const existing = this.metadataMap.get(assetId) ?? withMetadataFallbacks({ assetId });
        return withMetadataFallbacks({
            assetId,
            sourceCategory: existing.sourceCategory === "Publishing" || category === "Publishing" ? "Publishing" : category,
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
            compositionRightType: this.pick(existing.compositionRightType, row, ["composition right type", "right type"]),
            channelId: this.pick(existing.channelId, row, ["asset channel id", "channel id"]),
        });
    }
    pick(existingValue, row, aliases) {
        const discovered = findFirstValue(row, aliases);
        return discovered || existingValue;
    }
}
