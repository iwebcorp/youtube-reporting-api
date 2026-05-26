import * as fs from "fs";
import * as path from "path";
import type { AssetMetadata } from "../src/reporting/types.js";

function run(): void {
  const cachePath = path.resolve(process.cwd(), process.argv[2] ?? "asset_metadata_cache_split.json");
  const ids = (process.argv[3] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const metadataMap = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetMetadata>;
  const rows = ids.map((assetId) => {
    const metadata = metadataMap[assetId];
    return {
      assetId,
      title: metadata?.title ?? "",
      customId: metadata?.customId ?? "",
      writers: metadata?.writers ?? "",
      artist: metadata?.artist ?? "",
      assetType: metadata?.assetType ?? "",
      musicClaimType: metadata?.musicClaimType ?? "",
      compositionRightType: metadata?.compositionRightType ?? "",
      channelId: metadata?.channelId ?? "",
    };
  });

  console.log(JSON.stringify(rows, null, 2));
}

run();
