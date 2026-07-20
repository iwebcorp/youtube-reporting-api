# Publishing Royalty Rulebook

## Goal

Stabilize the publishing royalty block in `HaveToFix.md` with a month-specific validation gate.

Current `202604` target block:

- `1_publishing_daily_ad.csv`: `2464.324693`
- `2_publishing_daily_ad_adj.csv`: `2.905971599`
- `3_publishing_monthly_sub.csv`: `2742.18259`
- `4_publishing_ddex_dsr.csv`: `2.685787862`
- total: `5212.099043`

## Operating rule

Treat publishing royalties as a gated monthly rule set.

1. Keep `publishing_royalty_YYYYMM_targets.json` as the target ledger.
2. Keep `publishing_royalty_YYYYMM_candidate_rules.json` for publishing `2`.
3. Keep `publishing_royalty_YYYYMM_cms_title_candidates.json` for publishing `1`, `3`, and `4`.
4. The month passes only when `maxAbsDiff <= 0.001`.
5. `extract-client-package` now runs this gate automatically after settlement validation.

This is intentionally conservative. We are not pretending we already have one universal semantic rule that will explain every future month.

## Source split

Current best source-of-truth split for the publishing block:

- `1_publishing_daily_ad.csv`
  - CMS ad revenue title-family candidate set
- `2_publishing_daily_ad_adj.csv`
  - candidate operation set over the publishing adjustment probe
- `3_publishing_monthly_sub.csv`
  - CMS subscription title-family candidate set
- `4_publishing_ddex_dsr.csv`
  - CMS audio-tier title-family candidate set

## Why the gate exists

`202604` proved that the publishing block is not yet reducible to one simple reusable field rule.

- publishing `2` is still a mixed upscale-plus-drop operation set
- publishing `3` still depends on a mixed title-family subset
- publishing `4` is closer to an audio-title subset than to the previous DDEX rebuild

So the safe operating model is:

- automate generation
- automate validation
- block release when validation fails

## Validation commands

Package-vs-target comparison for already generated publishing files:

```bash
npm.cmd run validate-publishing-royalty -- --yearMonth=202604 --outputDir=reports_final_v27_202604_client_package
```

Legacy candidate-rule validation:

```bash
npm.cmd run validate-publishing-candidates -- --yearMonth=202604
```

Monthly release gate:

```bash
npm.cmd run validate-publishing-gate -- --yearMonth=202604
```

## Current `202604` gate result

- `publishing_daily_ad` diff: about `0.000098557`
- `publishing_daily_ad_adj` diff: about `0.000000775`
- `publishing_monthly_sub` diff: about `0.000181101`
- `publishing_ddex_dsr` diff: about `0.000003560`
- `publishing_total` diff: about `0.000282982`

## Release rule

Before a client package is treated as releasable for a month:

1. Update the three monthly rule artifacts.
2. Run `extract-client-package`.
3. Confirm the settlement gate passes.
4. Confirm the publishing gate passes.
5. If either gate fails, do not send the package.
