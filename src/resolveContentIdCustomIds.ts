// 월별 API 원본으로 Custom ID를 확정할 수 없는 자산만 Content ID API에서 조회해 저장한다.
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { pathToFileURL } from "url";
import { parse as parseCsvLine } from "csv-parse/sync";
import { getAuthClient } from "./auth.js";
import { AssetClassifier } from "./assetClassifier.js";
import { contentIdCustomIdFileName } from "./monthlyReadiness.js";
import { streamCsvRows } from "./reporting/parsers.js";
import { getErrorMessage, getErrorStatus, isDeletedOAuthClientError, withRetries } from "./reporting/retry.js";
import {
  clean,
  csvEscape,
  ensureDirectory,
  listMonthlyReportGroups,
  listMonthlySystemManagedFiles,
  parseCliArgs,
  resolveExtractionConfig,
} from "./reporting/utils.js";
import type { AssetCategory } from "./reporting/types.js";

const CONTENT_ID_ASSETS_URL = "https://youtubepartner.googleapis.com/youtube/partner/v1/assets";
const MAX_IDS_PER_REQUEST = 50;
const MAX_API_ATTEMPTS = 5;
// 정산 추출이 Custom ID를 읽는 자산 단위 원본 보고서. 소유자 디렉터리에 없는 유형은 건너뛴다.
const ASSET_REVENUE_REPORT_TYPES = [
  "content_owner_asset_ad_revenue_raw_a1",
  "content_owner_asset_ad_adjustment_revenue_raw_a1",
  "music_content_owner_asset_red_revenue_raw_a1",
  "music_content_owner_asset_red_adjustment_revenue_raw_a1",
  "publisher_content_owner_music_asset_red_revenue_raw_a1",
  "publisher_content_owner_asset_red_adjustment_revenue_raw_a1",
  "content_owner_claim_audio_tier_revenue_raw_a1",
];
const SHORTS_PLAYBACK_LOCATION_TYPE = "10";

type LookupStatus = "found" | "no_custom_id" | "not_found";

interface ContentIdAsset {
  id?: string;
  aliasId?: string[];
  metadataMine?: { customId?: string };
}

interface LookupResult {
  customId: string;
  status: LookupStatus;
}

function getRequiredOption(argv: string[], name: string): string {
  const prefix = `--${name}=`;
  const value = clean(argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length));
  if (!value) {
    throw new Error(`[ContentId] Missing required option: ${prefix}<value>`);
  }
  return value;
}

function parseOwnerCategory(value: string): Exclude<AssetCategory, "Unknown"> {
  if (value === "Neighboring" || value === "Publishing") return value;
  throw new Error(`[ContentId] --category must be Neighboring or Publishing. Received: "${value}"`);
}

// 일별 combined 보고서는 월 수 GB라 객체 파서 대신 줄 단위로 읽고, 따옴표가 있는 줄만 CSV 파서로 처리한다.
async function* readCombinedReportRows(filePath: string): AsyncIterable<{ assetId: string; playbackLocationType: string }> {
  let columns: { assetId: number; playbackLocationType: number } | undefined;
  const lines = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const values = line.includes('"') ? (parseCsvLine(line) as string[][])[0] ?? [] : line.split(",");
    if (!columns) {
      const headers = values.map((value) => clean(value).toLowerCase());
      columns = { assetId: headers.indexOf("asset_id"), playbackLocationType: headers.indexOf("playback_location_type") };
      if (columns.assetId < 0 || columns.playbackLocationType < 0) {
        throw new Error(`[ContentId] Missing asset_id or playback_location_type column in ${filePath}`);
      }
      continue;
    }
    yield { assetId: clean(values[columns.assetId]), playbackLocationType: clean(values[columns.playbackLocationType]) };
  }
}

export async function collectCandidates(options: {
  classifier: AssetClassifier;
  category: Exclude<AssetCategory, "Unknown">;
  yearMonth: string;
  systemManagedDir: string;
  reportDir: string;
}): Promise<Set<string>> {
  const { classifier, category, yearMonth, systemManagedDir, reportDir } = options;
  const candidates = new Set<string>();
  const hasMetadataCustomId = (assetId: string) => Boolean(classifier.getMetadata(assetId).customId);

  for (const reportType of ASSET_REVENUE_REPORT_TYPES) {
    for (const filePath of listMonthlySystemManagedFiles(systemManagedDir, yearMonth, reportType)) {
      console.log(`[ContentId] Scanning ${filePath}`);
      for await (const row of streamCsvRows(filePath)) {
        const assetId = clean(row["asset_id"]);
        if (!assetId || clean(row["custom_id"]) || hasMetadataCustomId(assetId)) continue;
        candidates.add(assetId);
      }
    }
  }

  // Shorts 사용량은 일별 combined 보고서에서 나오며, 산출물 Category 기준으로 조회 소유자를 정한다.
  const combinedFiles = listMonthlyReportGroups(reportDir, yearMonth).flatMap((group) => group.usageFiles);
  for (const filePath of combinedFiles) {
    for await (const { assetId, playbackLocationType } of readCombinedReportRows(filePath)) {
      if (playbackLocationType !== SHORTS_PLAYBACK_LOCATION_TYPE) continue;
      if (!assetId || hasMetadataCustomId(assetId)) continue;
      const isPublishing = classifier.classify(assetId) === "Publishing";
      if (isPublishing === (category === "Publishing")) candidates.add(assetId);
    }
  }
  console.log(`[ContentId] Scanned ${combinedFiles.length} daily combined reports for Shorts assets.`);

  return candidates;
}

async function fetchAssets(
  auth: Awaited<ReturnType<typeof getAuthClient>>,
  contentOwnerId: string,
  assetIds: string[],
): Promise<ContentIdAsset[]> {
  const response = await withRetries(`assets.list:${assetIds[0]}+${assetIds.length - 1}`, MAX_API_ATTEMPTS, () =>
    auth.request<{ items?: ContentIdAsset[] }>({
      url: CONTENT_ID_ASSETS_URL,
      params: {
        id: assetIds.join(","),
        onBehalfOfContentOwner: contentOwnerId,
        fetchMetadata: "mine",
        fields: "items(id,aliasId,metadataMine/customId)",
      },
    }),
  );
  return response.data.items ?? [];
}

async function lookupCustomIds(
  auth: Awaited<ReturnType<typeof getAuthClient>>,
  contentOwnerId: string,
  assetIds: string[],
): Promise<Map<string, LookupResult>> {
  const results = new Map<string, LookupResult>();

  const lookupBatch = async (batch: string[]): Promise<void> => {
    let items: ContentIdAsset[];
    try {
      items = await fetchAssets(auth, contentOwnerId, batch);
    } catch (error) {
      const status = getErrorStatus(error);
      if (status !== 400 && status !== 404) throw error;
      // 한 자산 때문에 묶음 전체가 거절되면 자산별로 다시 조회해 원인 자산만 not_found로 남긴다.
      if (batch.length > 1) {
        for (const assetId of batch) await lookupBatch([assetId]);
        return;
      }
      results.set(batch[0]!, { customId: "", status: "not_found" });
      return;
    }

    for (const item of items) {
      const customId = clean(item.metadataMine?.customId);
      // 병합된 자산은 요청한 ID가 aliasId로만 돌아올 수 있다.
      for (const assetId of [item.id, ...(item.aliasId ?? [])]) {
        const key = clean(assetId);
        if (!batch.includes(key)) continue;
        results.set(key, { customId, status: customId ? "found" : "no_custom_id" });
      }
    }
    for (const assetId of batch) {
      if (!results.has(assetId)) results.set(assetId, { customId: "", status: "not_found" });
    }
  };

  for (let index = 0; index < assetIds.length; index += MAX_IDS_PER_REQUEST) {
    await lookupBatch(assetIds.slice(index, index + MAX_IDS_PER_REQUEST));
    console.log(`[ContentId] Looked up ${Math.min(index + MAX_IDS_PER_REQUEST, assetIds.length)}/${assetIds.length}`);
  }
  return results;
}

function writeResults(outputPath: string, contentOwnerId: string, results: Map<string, LookupResult>): void {
  const lines = ["asset_id,custom_id,status,content_owner_id"];
  for (const [assetId, result] of [...results.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push([assetId, csvEscape(result.customId), result.status, contentOwnerId].join(","));
  }

  const partialPath = `${outputPath}.partial`;
  fs.writeFileSync(partialPath, `${lines.join("\n")}\n`, "utf-8");
  fs.renameSync(partialPath, outputPath);
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const contentOwnerId = getRequiredOption(argv, "contentOwnerId");
  const category = parseOwnerCategory(getRequiredOption(argv, "category"));
  const outputDir = path.resolve(getRequiredOption(argv, "contentIdDir"));
  const config = resolveExtractionConfig(parseCliArgs(argv.filter((argument) =>
    !["--contentOwnerId=", "--category=", "--contentIdDir="].some((prefix) => argument.startsWith(prefix)),
  )));
  const systemManagedDir = category === "Publishing" ? config.publishingSystemManagedDir : config.systemManagedDir;

  console.log(`[ContentId] yearMonth=${config.yearMonth} category=${category} contentOwnerId=${contentOwnerId}`);
  const classifier = new AssetClassifier();
  await classifier.initialize({
    yearMonth: config.yearMonth,
    neighboringDir: config.neighboringDir,
    publishingDir: config.publishingDir,
    includeContentIdCustomIds: false,
  });

  const candidates = await collectCandidates({
    classifier,
    category,
    yearMonth: config.yearMonth,
    systemManagedDir,
    reportDir: config.reportDir,
  });
  console.log(`[ContentId] Assets without a Custom ID in monthly API data: ${candidates.size}`);

  const results = candidates.size > 0
    ? await lookupCustomIds(await getAuthClient(), contentOwnerId, [...candidates].sort())
    : new Map<string, LookupResult>();

  ensureDirectory(outputDir);
  const outputPath = path.join(outputDir, contentIdCustomIdFileName(config.yearMonth));
  writeResults(outputPath, contentOwnerId, results);

  const counts = { found: 0, no_custom_id: 0, not_found: 0 };
  for (const result of results.values()) counts[result.status] += 1;
  console.log(
    `[ContentId] Wrote ${outputPath}. found=${counts.found} no_custom_id=${counts.no_custom_id} not_found=${counts.not_found}`,
  );
  if (counts.no_custom_id + counts.not_found > 0) {
    console.warn("[ContentId] CMS에 Custom ID가 없는 자산이 있습니다. 정산 파일 추출 후 Custom ID 입력 목록에 표시됩니다.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch(handleError);
}

function handleError(error: unknown): void {
  if (isDeletedOAuthClientError(error)) {
    console.error(
      "[ContentId] Google OAuth 클라이언트가 삭제되어 인증할 수 없습니다. Google Cloud의 Google Auth Platform > Clients > Deleted credentials에서 클라이언트를 복원한 뒤 다시 실행하세요.",
    );
  } else if (getErrorStatus(error) === 401 || getErrorStatus(error) === 403) {
    console.error(
      `[ContentId] Content ID API 접근이 거부되었습니다: ${getErrorMessage(error)}. OAuth 프로젝트의 Content ID API 사용 권한과 Content Owner 권한을 확인하세요.`,
    );
  } else {
    console.error(`[ContentId] Lookup failed: ${getErrorMessage(error)}`);
  }
  process.exitCode = 1;
}
