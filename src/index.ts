import { getAuthClient } from "./auth.js";

async function main() {
  const auth = await getAuthClient();
  console.log("인증 성공!", auth.credentials);
}

main().catch(console.error);
