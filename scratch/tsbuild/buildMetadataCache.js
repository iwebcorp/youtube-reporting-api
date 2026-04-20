import { AssetClassifier } from "./assetClassifier.js";
import { parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";
async function run() {
    const config = resolveExtractionConfig(parseCliArgs(process.argv.slice(2)));
    const classifier = new AssetClassifier();
    await classifier.initialize({
        neighboringDir: config.neighboringDir,
        publishingDir: config.publishingDir,
        cacheFile: config.cacheFile,
        forceRefresh: true,
    });
    console.log(`[MetadataBuild] Rebuilt cache: ${config.cacheFile}`);
}
run().catch((error) => {
    console.error("[MetadataBuild] Failed to rebuild metadata cache.", error);
    process.exitCode = 1;
});
