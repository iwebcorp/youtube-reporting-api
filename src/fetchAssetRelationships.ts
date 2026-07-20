import * as fs from "fs";
import * as path from "path";
import { getAuthClient } from "./auth.js";
import { loadConfig } from "./configLoader.js";

interface AssetRelationshipItem {
  id?: string;
  type?: string;
  sourceAssetId?: string;
  destinationAssetId?: string;
  parentAssetId?: string;
  childAssetId?: string;
  [key: string]: unknown;
}

interface AssetRelationshipCacheEntry {
  assetId: string;
  fetchedAt: string;
  relationshipTypes: string[];
  relatedAssetIds: string[];
  assetMetadata: Record<string, Record<string, unknown>>;
  embeddedRelations: AssetRelationshipItem[];
  allRelations: AssetRelationshipItem[];
}

function parseArgValue(prefix: string): string | null {
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!argument) {
    return null;
  }
  const raw = argument.slice(prefix.length).trim();
  return raw || null;
}

function parseDelayMs(): number {
  const rawValue = parseArgValue("--delayMs=");
  if (!rawValue) {
    return 1000;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadTargetAssetIds(): string[] {
  const assetIdsFile = parseArgValue("--assetIdsFile=");
  if (assetIdsFile) {
    const filePath = path.resolve(process.cwd(), assetIdsFile);
    if (!fs.existsSync(filePath)) {
      throw new Error(`[AssetRelationships] Missing asset id file: ${filePath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`[AssetRelationships] Invalid asset id file: ${filePath}`);
    }
    return parsed.map((value) => String(value).trim()).filter(Boolean);
  }

  const explicitAssetIds = parseArgValue("--assetIds=");
  if (explicitAssetIds) {
    return explicitAssetIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const defaultFilePath = path.resolve(process.cwd(), "publishing_asset_ids.json");
  if (!fs.existsSync(defaultFilePath)) {
    throw new Error(`[AssetRelationships] Missing asset id file: ${defaultFilePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(defaultFilePath, "utf-8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`[AssetRelationships] Invalid asset id file: ${defaultFilePath}`);
  }

  return parsed.map((value) => String(value).trim()).filter(Boolean);
}

function loadExistingCache(cacheFilePath: string): Record<string, AssetRelationshipCacheEntry> {
  if (!fs.existsSync(cacheFilePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(cacheFilePath, "utf-8")) as Record<string, AssetRelationshipCacheEntry>;
  } catch (error) {
    console.warn(`[AssetRelationships] Failed to parse ${cacheFilePath}. Starting with an empty cache.`, error);
    return {};
  }
}

function pickEmbeddedRelations(items: AssetRelationshipItem[]): AssetRelationshipItem[] {
  return items.filter((item) => {
    const type = String(item.type ?? "").toLowerCase();
    return type.includes("embed") || Boolean(item.parentAssetId || item.childAssetId);
  });
}

async function fetchAssetMetadataMap(
  auth: Awaited<ReturnType<typeof getAuthClient>>,
  contentOwnerId: string,
  assetIds: string[],
): Promise<Record<string, Record<string, unknown>>> {
  const uniqueAssetIds = Array.from(new Set(assetIds.map((value) => value.trim()).filter(Boolean)));
  const metadataByAssetId: Record<string, Record<string, unknown>> = {};

  for (let index = 0; index < uniqueAssetIds.length; index += 50) {
    const batch = uniqueAssetIds.slice(index, index + 50);
    const query = new URLSearchParams({
      id: batch.join(","),
      onBehalfOfContentOwner: contentOwnerId,
      fetchMetadata: "effective",
    });

    const response = await auth.request<{ items?: Array<Record<string, unknown> & { id?: string; metadata?: Record<string, unknown> }> }>({
      url: `https://www.googleapis.com/youtube/partner/v1/assets?${query.toString()}`,
    });

    for (const item of response.data.items ?? []) {
      const assetId = String(item.id ?? "").trim();
      if (!assetId) {
        continue;
      }
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      metadataByAssetId[assetId] = {
        assetId,
        type: item["type"] ?? "",
        customId: metadata["customId"] ?? "",
        isrc: metadata["isrc"] ?? "",
        iswc: metadata["iswc"] ?? "",
        upc: metadata["upc"] ?? metadata["grid"] ?? "",
        title: metadata["title"] ?? "",
        artists: metadata["artist"] ?? [],
        writers: metadata["writers"] ?? [],
        compositionRightType: metadata["compositionRightType"] ?? "",
        metadata,
      };
    }
  }

  return metadataByAssetId;
}

async function fetchRelationshipsForAsset(
  auth: Awaited<ReturnType<typeof getAuthClient>>,
  contentOwnerId: string,
  assetId: string,
): Promise<AssetRelationshipItem[]> {
  const items: AssetRelationshipItem[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      assetId,
      onBehalfOfContentOwner: contentOwnerId,
    });
    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const response = await auth.request<{ items?: AssetRelationshipItem[]; nextPageToken?: string }>({
      url: `https://www.googleapis.com/youtube/partner/v1/assetRelationships?${query.toString()}`,
    });

    items.push(...(response.data.items ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return items;
}

async function buildCacheEntry(
  auth: Awaited<ReturnType<typeof getAuthClient>>,
  contentOwnerId: string,
  assetId: string,
  relations: AssetRelationshipItem[],
): Promise<AssetRelationshipCacheEntry> {
  const relationshipTypes = Array.from(
    new Set(relations.map((item) => String(item.type ?? "").trim()).filter(Boolean)),
  ).sort();

  const relatedAssetIds = Array.from(
    new Set(
      relations.flatMap((item) => [
        String(item.sourceAssetId ?? "").trim(),
        String(item.destinationAssetId ?? "").trim(),
        String(item.parentAssetId ?? "").trim(),
        String(item.childAssetId ?? "").trim(),
      ]),
    ),
  )
    .filter((value) => value && value !== assetId)
    .sort();

  const assetMetadata = await fetchAssetMetadataMap(auth, contentOwnerId, [assetId, ...relatedAssetIds]);

  return {
    assetId,
    fetchedAt: new Date().toISOString(),
    relationshipTypes,
    relatedAssetIds,
    assetMetadata,
    embeddedRelations: pickEmbeddedRelations(relations),
    allRelations: relations,
  };
}

async function run(): Promise<void> {
  const cfg = loadConfig();
  const auth = await getAuthClient();
  const assetIds = loadTargetAssetIds();
  const cacheFilePath = path.resolve(
    process.cwd(),
    parseArgValue("--cacheFile=") ?? "asset_relationship_cache.json",
  );
  const delayMs = parseDelayMs();
  const cache = loadExistingCache(cacheFilePath);

  console.log(`[AssetRelationships] target assets=${assetIds.length} cache=${cacheFilePath} delayMs=${delayMs}`);

  let processed = 0;
  for (const assetId of assetIds) {
    if (cache[assetId]) {
      processed += 1;
      continue;
    }

    try {
      const relations = await fetchRelationshipsForAsset(auth, cfg.contentOwnerId, assetId);
      cache[assetId] = await buildCacheEntry(auth, cfg.contentOwnerId, assetId, relations);
      processed += 1;

      if (processed % 25 === 0 || processed === assetIds.length) {
        fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), "utf-8");
        console.log(`[AssetRelationships] progress ${processed}/${assetIds.length}`);
      }
    } catch (error) {
      console.error(`[AssetRelationships] Failed asset=${assetId}`, error);
    }

    if (delayMs > 0 && processed < assetIds.length) {
      await sleep(delayMs);
    }
  }

  fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`[AssetRelationships] Saved cache to ${cacheFilePath}`);
}

run().catch((error) => {
  console.error("[AssetRelationships] Failed.", error);
  process.exitCode = 1;
});
