import { getAuthClient } from "./src/auth.js";
import * as fs from "fs";
const CONTENT_OWNER_ID = "2jFu0i9K0PE3MDrkU_UUfQ";
async function run() {
  const auth = await getAuthClient();
  const res = await auth.request<any>({
    url: `https://www.googleapis.com/youtube/partner/v1/assets?id=A874461896561869&onBehalfOfContentOwner=${CONTENT_OWNER_ID}&fetchMetadata=effective`,
  });
  fs.writeFileSync("test_asset_out.json", JSON.stringify(res.data, null, 2));
}
run();
