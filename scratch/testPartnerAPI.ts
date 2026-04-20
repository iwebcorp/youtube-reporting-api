import { getAuthClient } from "../src/auth.js";

async function testPartnerAPI() {
  try {
    const auth = await getAuthClient();

    const contentOwnerId = "2jFu0i9K0PE3MDrkU_UUfQ";
    const sampleAssetId = "A874461896561869";

    const res = await auth.request<any>({
      url: `https://www.googleapis.com/youtube/partner/v1/assets?id=${sampleAssetId}&onBehalfOfContentOwner=${contentOwnerId}&fetchMetadata=metadata`,
    });

    console.log("Asset metadata:");
    console.log(JSON.stringify(res.data, null, 2));

  } catch (err: any) {
    if (err.response) {
       console.error("HTTP Error", err.response.status, err.response.data);
    } else {
       console.error("Error:", err.message);
    }
  }
}

testPartnerAPI();
