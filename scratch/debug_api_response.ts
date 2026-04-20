import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

async function main() {
  const cfg = loadConfig();
  const auth = await getAuthClient();

  const assetId = 'A184229807220106'; // Yeram Worship - Way Maker 자산 ID
  console.log(`[Debug] Asset ID: ${assetId} 조회 중...`);

  try {
    const res = await auth.request({
      url: 'https://www.googleapis.com/youtube/partner/v1/assets',
      params: {
        id: assetId,
        onBehalfOfContentOwner: cfg.contentOwnerId,
        fetchMetadata: true
      }
    });

    console.log("[Debug] API Response (Raw):");
    console.log(JSON.stringify(res.data, null, 2));

    const totalResults = (res.data as any).items?.length || 0;
    console.log(`\n[Debug] Total Results Found: ${totalResults}`);

  } catch (err: any) {
    console.error("[Debug] API 호출 실패:", err.message);
    if (err.response) {
      console.error("[Debug] Error Body:", JSON.stringify(err.response.data, null, 2));
    }
  }
}

main().catch(console.error);
