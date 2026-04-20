import { AssetClassifier } from "../src/assetClassifier.ts";
import * as path from "path";

async function run() {
  const classifier = new AssetClassifier();
  await classifier.initialize(
    path.join(process.cwd(), "인접"),
    path.join(process.cwd(), "저작")
  );
  console.log("✅ 마스터 메타데이터 캐시 생성이 완료되었습니다.");
}

run().catch(console.error);
