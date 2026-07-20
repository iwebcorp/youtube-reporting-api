# Client Package Runbook

## Goal

Generate a 9-file client package whose summed settlement amount matches the YouTube Reporting API system-managed source data.

## Source of truth

Only use files downloaded by our own API flow.

Required system-managed report types:

- `content_owner_asset_ad_revenue_raw_a1`
- `content_owner_asset_ad_adjustment_revenue_raw_a1`
- `music_content_owner_asset_red_revenue_raw_a1`
- `music_content_owner_asset_red_adjustment_revenue_raw_a1`
- `content_owner_claim_audio_tier_revenue_summary_a1`
- `content_owner_claim_audio_tier_revenue_raw_a1`
- `music_content_owner_shorts_revenue_summary_a1`

## Output structure

The client package must contain exactly these 9 files:

- `1_neighboring_daily_ad.csv`
- `1_publishing_daily_ad.csv`
- `2_neighboring_daily_ad_adj.csv`
- `2_publishing_daily_ad_adj.csv`
- `3_neighboring_monthly_sub.csv`
- `3_publishing_monthly_sub.csv`
- `4_neighboring_financial_detail.csv`
- `4_publishing_ddex_dsr.csv`
- `5_publishing_shorts_revenue_summary.csv`

## Rules

- Ads adjustments are included if they exist in the settlement file, even when their `day` value points to an earlier month.
- Shorts revenue is always exported as its own 9th file.
- DDEX audio tier totals must include all countries, not only `KR`.
- Settlement validation must compare the 9-file package total against the system-managed API total directly.

## Monthly commands

1. Download system-managed reports:

```bash
npm.cmd run download-system-managed -- --yearMonth=YYYYMM --systemManagedDir=reports/system-managed
```

2. Generate and validate the client package:

```bash
npm.cmd run extract-client-package -- --yearMonth=YYYYMM --outputDir=reports_final_vXX_YYYYMM_client_package
```

3. Optional manual validation rerun:

```bash
npm.cmd run validate-settlement-package -- --yearMonth=YYYYMM --outputDir=reports_final_vXX_YYYYMM_client_package
```

If step 2 succeeds, the package total already matches the API settlement total.
