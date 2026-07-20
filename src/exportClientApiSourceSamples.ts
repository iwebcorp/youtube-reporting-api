import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import iconv from "iconv-lite";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

type SourceKind = "csv" | "multi_record_tsv";

interface SourceDefinition {
  id: string;
  label: string;
  description: string;
  filePath?: string;
  kind: SourceKind;
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  if (delimiter === "\t") {
    return line.split("\t");
  }

  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function decodeText(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("�")) {
    return utf8;
  }
  return iconv.decode(buffer, "cp949");
}

function findFirstMatchingFile(dirPath: string, matcher: (fileName: string) => boolean): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  return fs
    .readdirSync(dirPath)
    .filter((fileName) => matcher(fileName))
    .sort()
    .map((fileName) => path.join(dirPath, fileName))[0];
}

function buildSourceDefinitions(yearMonth: string): SourceDefinition[] {
  const systemManagedDir = path.resolve(process.cwd(), "reports", "system-managed");
  const cmsDir = path.resolve(process.cwd(), "from _cms");

  return [
    {
      id: "system_managed_ad_revenue",
      label: "System-managed Ads Revenue Raw",
      description: "광고 수익 원천 API 파일",
      filePath: findFirstMatchingFile(
        systemManagedDir,
        (fileName) => fileName.startsWith(`${yearMonth}_content_owner_asset_ad_revenue_raw_a1_`) && fileName.endsWith(".csv"),
      ),
      kind: "csv",
    },
    {
      id: "system_managed_ad_adjustment",
      label: "System-managed Ads Adjustment Raw",
      description: "광고 조정 수익 원천 API 파일",
      filePath: findFirstMatchingFile(
        systemManagedDir,
        (fileName) =>
          fileName.startsWith(`${yearMonth}_content_owner_asset_ad_adjustment_revenue_raw_a1_`) &&
          fileName.endsWith(".csv"),
      ),
      kind: "csv",
    },
    {
      id: "system_managed_subscription_revenue",
      label: "System-managed Subscription Revenue Raw",
      description: "YouTube Premium/Music Premium 수익 원천 API 파일",
      filePath: findFirstMatchingFile(
        systemManagedDir,
        (fileName) =>
          fileName.startsWith(`${yearMonth}_music_content_owner_asset_red_revenue_raw_a1_`) && fileName.endsWith(".csv"),
      ),
      kind: "csv",
    },
    {
      id: "system_managed_subscription_adjustment",
      label: "System-managed Subscription Adjustment Raw",
      description: "구독 조정 수익 원천 API 파일",
      filePath: findFirstMatchingFile(
        systemManagedDir,
        (fileName) =>
          fileName.startsWith(`${yearMonth}_music_content_owner_asset_red_adjustment_revenue_raw_a1_`) &&
          fileName.endsWith(".csv"),
      ),
      kind: "csv",
    },
    {
      id: "system_managed_audio_tier",
      label: "System-managed Audio Tier Revenue Raw",
      description: "오디오 등급 수익 원천 API 파일",
      filePath: findFirstMatchingFile(
        systemManagedDir,
        (fileName) =>
          fileName.startsWith(`${yearMonth}_content_owner_claim_audio_tier_revenue_raw_a1_`) && fileName.endsWith(".csv"),
      ),
      kind: "multi_record_tsv",
    },
    {
      id: "system_managed_shorts_summary",
      label: "System-managed Shorts Revenue Summary",
      description: "Shorts 수익 원천 API 요약 파일",
      filePath: findFirstMatchingFile(
        systemManagedDir,
        (fileName) =>
          fileName.startsWith(`${yearMonth}_music_content_owner_shorts_revenue_summary_a1_`) && fileName.endsWith(".csv"),
      ),
      kind: "csv",
    },
    {
      id: "cms_asset_ad_revenue",
      label: "CMS Asset Ad Revenue",
      description: "CMS 저작물 광고 수익 파일",
      filePath: findFirstMatchingFile(
        cmsDir,
        (fileName) => fileName.startsWith(`YouTube_kwangsoomedia_M_${yearMonth}01_`) && fileName.includes("_asset_raw_"),
      ),
      kind: "csv",
    },
    {
      id: "cms_asset_subscription_revenue",
      label: "CMS Asset Subscription Revenue",
      description: "CMS 저작물 구독 수익 파일",
      filePath: findFirstMatchingFile(
        cmsDir,
        (fileName) =>
          fileName.startsWith(`YouTube_kwangsoomedia_M_${yearMonth}01_`) &&
          fileName.includes("red_label_rawdata_asset"),
      ),
      kind: "csv",
    },
    {
      id: "cms_asset_audio_tier_revenue",
      label: "CMS Asset Audio Tier Revenue",
      description: "CMS 저작물 오디오 등급 수익 파일",
      filePath: findFirstMatchingFile(
        cmsDir,
        (fileName) => fileName.startsWith(`YouTube_kwangsoomedia_Audio_Tier_${yearMonth}01_`) && fileName.endsWith(".csv"),
      ),
      kind: "csv",
    },
  ];
}

function exportCsvSample(source: SourceDefinition, outputDir: string): string {
  const text = decodeText(source.filePath).replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const hasSummaryLine = lines[0] === "Asset Summary";
  const headerIndex = hasSummaryLine ? 1 : 0;
  const headerLine = lines[headerIndex] ?? "";
  const columns = parseDelimitedLine(headerLine.replace(/^\uFEFF/, ""), ",");
  const dataStartIndex = hasSummaryLine ? 2 : 1;
  const sampleLines = lines.slice(0, dataStartIndex).concat(lines.slice(dataStartIndex, dataStartIndex + 10));
  const outputFileName = `${source.id}_sample.csv`;
  fs.writeFileSync(path.join(outputDir, outputFileName), sampleLines.join("\n") + "\n", "utf8");

  return [
    `## ${source.label}`,
    ``,
    `- 설명: ${source.description}`,
    `- 원본 파일: \`${path.basename(source.filePath)}\``,
    `- 샘플 파일: \`${outputFileName}\``,
    `- 열 개수: ${columns.length}`,
    `- 열 목록:`,
    ...columns.map((column, index) => `  ${index + 1}. ${column}`),
    ``,
  ].join("\n");
}

function exportMultiRecordTsvSample(source: SourceDefinition, outputDir: string): string {
  const text = decodeText(source.filePath).replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const sampleLines = lines.slice(0, 12);
  const outputFileName = `${source.id}_sample.tsv`;
  fs.writeFileSync(path.join(outputDir, outputFileName), sampleLines.join("\n") + "\n", "utf8");

  const headerLines = lines.filter((line) => line.startsWith("#")).slice(0, 10);
  const sections = headerLines.map((line) => {
    const columns = parseDelimitedLine(line, "\t");
    const recordType = columns[0] ?? "";
    return [
      `- ${recordType}`,
      ...columns.slice(1).map((column, index) => `  ${index + 1}. ${column}`),
    ].join("\n");
  });

  return [
    `## ${source.label}`,
    ``,
    `- 설명: ${source.description}`,
    `- 원본 파일: \`${path.basename(source.filePath)}\``,
    `- 샘플 파일: \`${outputFileName}\``,
    `- 레코드 타입별 열 목록:`,
    ...sections,
    ``,
  ].join("\n");
}

export async function runExportClientApiSourceSamples(
  cliArgs: string[] = process.argv.slice(2),
): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(cliArgs));
  const outputDir = path.resolve(process.cwd(), `client_api_source_samples_${config.yearMonth}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const sections = [
    `# API Source Samples ${config.yearMonth}`,
    ``,
    `클라이언트 요청용 원천 자료 항목(열) 정보와 예시 10행입니다.`,
    ``,
  ];

  for (const source of buildSourceDefinitions(config.yearMonth)) {
    if (!source.filePath || !fs.existsSync(source.filePath)) {
      sections.push(`## ${source.label}`, ``, `- 원본 파일 없음`, ``);
      continue;
    }

    sections.push(
      source.kind === "csv" ? exportCsvSample(source, outputDir) : exportMultiRecordTsvSample(source, outputDir),
    );
  }

  fs.writeFileSync(path.join(outputDir, "README.md"), sections.join("\n"), "utf8");
  console.log(`[ExportClientApiSourceSamples] Wrote ${outputDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runExportClientApiSourceSamples().catch((error) => {
    console.error("[ExportClientApiSourceSamples] Export failed.", error);
    process.exitCode = 1;
  });
}
