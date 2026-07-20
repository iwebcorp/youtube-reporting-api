// PLA Payment Summary와 음악 상세의 차액으로 GE 총액을 생성하는 실행기
import * as fs from "fs";
import * as path from "path";
import iconv from "iconv-lite";
import { parseCsvRows } from "./reporting/parsers.js";
import { clean, listMonthlySystemManagedFiles, parseCliArgs, resolveExtractionConfig } from "./reporting/utils.js";

async function run(): Promise<void> {
  const config = resolveExtractionConfig(parseCliArgs(process.argv.slice(2)));
  const paymentFiles = listMonthlySystemManagedFiles(
    config.publishingSystemManagedDir,
    config.yearMonth,
    "content_owner_payments_summary_a1",
  );
  const detailFiles = listMonthlySystemManagedFiles(
    config.publishingSystemManagedDir,
    config.yearMonth,
    "publisher_content_owner_music_asset_red_revenue_raw_a1",
  );
  if (paymentFiles.length === 0 || detailFiles.length === 0) {
    throw new Error(`[PublishingGE] Missing payments summary or publisher music detail for ${config.yearMonth}`);
  }

  const paymentRows = (await Promise.all(paymentFiles.map((file) => parseCsvRows(file)))).flat();
  const subscriptionRow = paymentRows.find((row) =>
    clean(row["revenue_type"]).startsWith("Subscriptions Revenue"),
  );
  if (!subscriptionRow) {
    throw new Error(`[PublishingGE] Subscription total not found for ${config.yearMonth}`);
  }

  const subscriptionTotal = Number(subscriptionRow["partner_revenue_usd"] ?? 0);
  let musicDetailTotal = 0;
  for (const file of detailFiles) {
    for (const row of await parseCsvRows(file)) {
      musicDetailTotal += Number(row["partner_revenue_usd"] ?? row["partner_revenue"] ?? 0) || 0;
    }
  }
  const geTotal = subscriptionTotal - musicDetailTotal;
  const lines = [
    "month,country,revenue_type,partner_revenue_usd,detail_availability,subscription_total_usd,music_detail_total_usd,calculation",
    [
      config.yearMonth,
      "KR",
      "GE",
      geTotal.toFixed(12),
      "summary_only",
      subscriptionTotal.toFixed(12),
      musicDetailTotal.toFixed(12),
      "payments subscription total - publisher music asset raw total",
    ].join(","),
  ];

  fs.mkdirSync(config.outputDir, { recursive: true });
  const outputPath = path.join(config.outputDir, "publishing_ge_summary.csv");
  fs.writeFileSync(outputPath, iconv.encode(`${lines.join("\r\n")}\r\n`, "cp949"));
  console.log(
    `[PublishingGE] Wrote ${outputPath}. subscription=${subscriptionTotal.toFixed(12)} detail=${musicDetailTotal.toFixed(12)} ge=${geTotal.toFixed(12)}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
