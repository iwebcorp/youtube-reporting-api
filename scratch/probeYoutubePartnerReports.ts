import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

async function probe(url: string): Promise<void> {
  const auth = await getAuthClient();
  try {
    const response = await auth.request({ url });
    console.log(`OK ${url}`);
    console.log(JSON.stringify(response.data, null, 2).slice(0, 4000));
  } catch (error: any) {
    console.log(`FAIL ${url}`);
    console.log(error?.response?.status ?? error?.status ?? "");
    console.log(JSON.stringify(error?.response?.data ?? error?.message ?? error, null, 2).slice(0, 2000));
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const owner = encodeURIComponent(cfg.contentOwnerId);
  await probe(`https://www.googleapis.com/youtube/partner/v1/reports?onBehalfOfContentOwner=${owner}`);
  await probe(`https://www.googleapis.com/youtube/partner/v1/reportTypes?onBehalfOfContentOwner=${owner}`);
  await probe(`https://www.googleapis.com/youtube/partner/v1/financialReports?onBehalfOfContentOwner=${owner}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
