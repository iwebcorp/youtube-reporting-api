import { runNeighboringExtraction } from "./extractCsvs.js";
import { runPublishingExtraction } from "./extractPublishingCsvs.js";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
function buildForwardArgs(config) {
    return [
        `--yearMonth=${config.yearMonth}`,
        `--reportDir=${config.reportDir}`,
        `--outputDir=${config.outputDir}`,
        `--neighboringDir=${config.neighboringDir}`,
        `--publishingDir=${config.publishingDir}`,
        `--cacheFile=${config.cacheFile}`,
    ];
}
async function run() {
    const config = resolveExtractionConfig(parseCliArgs(process.argv.slice(2)));
    const forwardArgs = buildForwardArgs(config);
    console.log(`[ClientPackage] Start monthly export package for ${config.yearMonth}`);
    console.log(`[ClientPackage] Output directory: ${config.outputDir}`);
    await runNeighboringExtraction(forwardArgs);
    await runPublishingExtraction(forwardArgs);
    console.log(`[ClientPackage] Completed. Generated 8 client-facing files for ${config.yearMonth}.`);
}
run().catch((error) => {
    console.error("[ClientPackage] Extraction failed.", error);
    process.exitCode = 1;
});
