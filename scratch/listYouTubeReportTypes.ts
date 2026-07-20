import { google } from "googleapis";
import { getAuthClient } from "../src/auth.js";
import { loadConfig } from "../src/configLoader.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const auth = await getAuthClient();
  const yt = google.youtubereporting({ version: "v1", auth });

  for (const includeSystemManaged of [false, true]) {
    console.log(`includeSystemManaged=${includeSystemManaged}`);
    let pageToken: string | undefined;
    do {
      const response = await yt.reportTypes.list({
        onBehalfOfContentOwner: cfg.contentOwnerId,
        includeSystemManaged,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const reportType of response.data.reportTypes ?? []) {
        const id = reportType.id ?? "";
        const name = reportType.name ?? "";
        const systemManaged = reportType.systemManaged ?? "";
        console.log(`${id}\t${systemManaged}\t${name}`);
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
