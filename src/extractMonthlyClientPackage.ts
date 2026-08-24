import { runNeighboringExtraction } from "./extractCsvs.js";
import { runPublishingExtraction } from "./extractPublishingCsvs.js";
import { runPublishingShortsSummary } from "./extractPublishingShortsSummary.js";
import { runSettlementValidation } from "./validateSettlementPackage.js";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

function buildForwardArgs(config: ReturnType<typeof resolveExtractionConfig>): string[] {
  return [
    `--yearMonth=${config.yearMonth}`,
    `--reportDir=${config.reportDir}`,
    `--outputDir=${config.outputDir}`,
    `--neighboringDir=${config.neighboringDir}`,
    `--publishingDir=${config.publishingDir}`,
    `--cacheFile=${config.cacheFile}`,
    `--systemManagedDir=${config.systemManagedDir}`,
    `--publishingSystemManagedDir=${config.publishingSystemManagedDir}`,
    `--sampleDir=${config.sampleDir}`,
  ];
}

async function run(): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(process.argv.slice(2)));
  const forwardArgs = buildForwardArgs(config);

  console.log(`[ClientPackage] Start monthly export package for ${config.yearMonth}`);
  console.log(`[ClientPackage] Output directory: ${config.outputDir}`);

  await runNeighboringExtraction(forwardArgs);
  await runPublishingExtraction(forwardArgs);
  await runPublishingShortsSummary(forwardArgs);
  await runSettlementValidation(forwardArgs);

  console.log(
    `[ClientPackage] Completed. Generated 9 settlement files and passed validation for ${config.yearMonth}.`,
  );
}

run().catch((error) => {
  console.error("[ClientPackage] Extraction failed.", error);
  process.exitCode = 1;
});
