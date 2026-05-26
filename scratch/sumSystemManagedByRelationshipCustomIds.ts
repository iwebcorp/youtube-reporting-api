import * as fs from "fs";
import * as path from "path";
import { parseCsvRows } from "../src/reporting/parsers.js";

interface AssetRelationshipItem {
  assetMetadata?: Record<string, Record<string, unknown>>;
}

function fileNameMatchesYearMonth(fileName: string, yearMonth: string): boolean {
  const firstDateToken = fileName.match(/\d{4}-\d{2}|\d{8}|\d{6}/)?.[0];
  return firstDateToken ? firstDateToken.replace(/-/g, "").startsWith(yearMonth) : false;
}

function toNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadRelationshipCustomIds(cachePath: string): Set<string> {
  const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, AssetRelationshipItem>;
  const customIds = new Set<string>();
  for (const entry of Object.values(parsed)) {
    for (const metadata of Object.values(entry.assetMetadata ?? {})) {
      if ((metadata.type ?? "") !== "sound_recording") continue;
      const customId = String(metadata.customId ?? "").trim();
      if (customId) {
        customIds.add(customId);
      }
    }
  }
  return customIds;
}

async function run(): Promise<void> {
  const yearMonth = process.argv[2] ?? "202604";
  const relationshipCachePath = path.resolve(
    process.cwd(),
    process.argv[3] ?? "scratch/ad_pub_adj_relationships.json",
  );
  const fileToken = process.argv[4] ?? "content_owner_asset_ad_adjustment_revenue_raw_a1";
  const revenueColumn = process.argv[5] ?? "partner_revenue";
  const systemManagedDir = path.resolve(process.cwd(), "reports/system-managed");
  const relationshipCustomIds = loadRelationshipCustomIds(relationshipCachePath);

  const files = fs
    .readdirSync(systemManagedDir)
    .filter((fileName) => fileName.endsWith(".csv"))
    .filter((fileName) => fileNameMatchesYearMonth(fileName, yearMonth))
    .filter((fileName) => fileName.includes(fileToken))
    .sort();

  let total = 0;
  let matchedRows = 0;
  const byAdjustment = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const matchedCustomIds = new Set<string>();

  for (const fileName of files) {
    const rows = await parseCsvRows(path.join(systemManagedDir, fileName));
    for (const row of rows) {
      const customId = (row["custom_id"] ?? "").trim();
      if (!relationshipCustomIds.has(customId)) continue;
      const revenue = toNumber(row[revenueColumn] ?? row["partner_revenue"]);
      total += revenue;
      matchedRows += 1;
      matchedCustomIds.add(customId);

      const adjustmentType = (row["adjustment_type"] ?? "None").trim() || "None";
      const country = (row["country"] ?? row["country_code"] ?? "XX").trim() || "XX";
      byAdjustment.set(adjustmentType, (byAdjustment.get(adjustmentType) ?? 0) + revenue);
      byCountry.set(country, (byCountry.get(country) ?? 0) + revenue);
    }
  }

  console.log(
    JSON.stringify(
      {
        yearMonth,
        relationshipCachePath,
        fileToken,
        revenueColumn,
        relationshipCustomIds: relationshipCustomIds.size,
        matchedCustomIds: matchedCustomIds.size,
        matchedRows,
        total,
        byAdjustment: Object.fromEntries([...byAdjustment.entries()].sort((a, b) => b[1] - a[1])),
        byCountry: Object.fromEntries([...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("[SumSystemManagedByRelationshipCustomIds] Failed.", error);
  process.exitCode = 1;
});
