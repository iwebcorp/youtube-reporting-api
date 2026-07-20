# 9개 클라이언트 패키지 추출 호출 순서

## 기준과 가정

이 문서는 `npm run extract-client-package -- --yearMonth=YYYYMM --outputDir=...`를 실행한다고 가정한다.

사전 준비 단계인 `download-system-managed`, `build-metadata-cache`는 이미 끝났고, 입력 CSV와 캐시가 준비되어 있어야 한다. 실제 9개 산출물 생성은 `src/extractMonthlyClientPackage.ts`에서 아래 순서로 호출된다.

```ts
await runNeighboringExtraction(forwardArgs);
await runPublishingExtraction(forwardArgs);
await runPublishingShortsSummary(forwardArgs);
await runSettlementValidation(forwardArgs);
```

따라서 산출물 생성 순서는 크게 인접저작권 4개, 저작권 4개, Shorts 1개, 검증 순서다.

## 전체 호출 순서

| 순서 | 호출 파일/함수                                                         | 역할                               | 생성/검증되는 파일                                                                                                                    |
| ---: | ---------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | `src/extractMonthlyClientPackage.ts` -> `runNeighboringExtraction()`   | 인접저작권 산출물 4개 생성         | `1_neighboring_daily_ad.csv`, `2_neighboring_daily_ad_adj.csv`, `3_neighboring_monthly_sub.csv`, `4_neighboring_financial_detail.csv` |
|    2 | `src/extractMonthlyClientPackage.ts` -> `runPublishingExtraction()`    | 저작권 산출물 4개 생성             | `1_publishing_daily_ad.csv`, `2_publishing_daily_ad_adj.csv`, `3_publishing_monthly_sub.csv`, `4_publishing_ddex_dsr.csv`             |
|    3 | `src/extractMonthlyClientPackage.ts` -> `runPublishingShortsSummary()` | Shorts 수익 산출물 1개 생성        | `5_publishing_shorts_revenue_summary.csv`                                                                                             |
|    4 | `src/extractMonthlyClientPackage.ts` -> `runSettlementValidation()`    | 9개 파일 합계와 API 원천 합계 검증 | 신규 산출물 없음                                                                                                                      |

## 입력 파일을 찾는 방식

`resolveExtractionConfig()`가 `yearMonth`, `reportDir`, `outputDir`, `systemManagedDir`, `cacheFile`, `neighboringDir`, `publishingDir`를 확정한다.

월별 system-managed 입력 파일은 `listMonthlySystemManagedFiles(systemManagedDir, yearMonth, reportTypeId)`로 찾는다. 파일명은 다음 형식을 기준으로 한다.

```text
YYYYMM_{reportTypeId}_{startLabel}_{endLabel}_{createLabel}.csv
```

같은 coverage 파일이 여러 개 있으면 `createLabel`이 더 큰 최신 파일을 사용한다.

## 1단계: 인접저작권 4개 파일

호출 위치: `src/extractCsvs.ts`의 `runNeighboringExtraction()`

| 생성 순서 | 출력 파일                            | 원천 report type                                                                                          | 처리 함수                                                            | 추출 데이터                                                                                                                                                           |
| --------: | ------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|         1 | `1_neighboring_daily_ad.csv`         | `content_owner_asset_ad_revenue_raw_a1`                                                                   | `writeAdvertisingReports()` -> `writeNeighboringAdRow()`             | 인접저작권 일별 광고 수익. 날짜, 국가, asset id, title, custom id, ISRC/UPC, artist/album/label, owned views, YouTube revenue split, partner revenue 등을 출력한다.   |
|         2 | `2_neighboring_daily_ad_adj.csv`     | `content_owner_asset_ad_adjustment_revenue_raw_a1`                                                        | `writeAdvertisingReports()` -> `writeNeighboringAdRow()`             | 인접저작권 광고 조정 수익. 광고 수익 파일과 같은 컬럼 구조를 쓰며 `adjustment_type`이 있는 조정 데이터를 별도 파일로 쓴다.                                            |
|         3 | `3_neighboring_monthly_sub.csv`      | `music_content_owner_asset_red_revenue_raw_a1`, `music_content_owner_asset_red_adjustment_revenue_raw_a1` | `parseRedSummaryFiles()` -> `writeNeighboringMonthlySummary()`       | 인접저작권 월별 YouTube Premium/RED 수익과 조정분. 국가/asset 단위로 owned views, monetized views, pro rata revenue, per-sub-min revenue, partner revenue를 집계한다. |
|         4 | `4_neighboring_financial_detail.csv` | `content_owner_claim_audio_tier_revenue_raw_a1`                                                           | `parseAudioTierDetailFiles()` -> `writeNeighboringFinancialDetail()` | 인접저작권 audio tier 상세. 날짜, 국가, video id, asset id, custom id, ISRC/UPC/GRID, owned views, pro rata, per-play-min, partner revenue를 출력한다.                |

인접저작권 단계에서는 `AssetClassifier`가 `asset_metadata_cache.json`과 원본 디렉터리를 읽어 title, custom id, ISRC, UPC, artist, album, label 같은 메타데이터 누락값을 보강한다.

## 2단계: 저작권 4개 파일

호출 위치: `src/extractPublishingCsvs.ts`의 `runPublishingExtraction()`

| 생성 순서 | 출력 파일                       | 원천 report type/source                                                                                   | 처리 함수                                                                                   | 추출 데이터                                                                                                                                                                        |
| --------: | ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|         5 | `1_publishing_daily_ad.csv`     | `content_owner_asset_ad_revenue_raw_a1` + `reports/`의 `content_owner_asset_combined_a3` usage 파일       | `parsePublishingFinancialFiles()` -> `buildMonthlyAdSummary()` -> `writeMonthlyAdSummary()` | 저작권 월/국가/asset 기준 광고 수익. revenue raw에서 광고 금액을 가져오고 usage report에서 watch page, embedded player, channel page, live/on-demand, ad-enabled views를 보강한다. |
|         6 | `2_publishing_daily_ad_adj.csv` | `content_owner_asset_ad_adjustment_revenue_raw_a1`                                                        | `writeFinancialAdjustments()` -> `writeAdjustmentRow()`                                     | 저작권 광고 조정 수익. adjustment type, day, country, asset metadata, owned views, YouTube revenue split, partner revenue를 출력한다.                                              |
|         7 | `3_publishing_monthly_sub.csv`  | `music_content_owner_asset_red_revenue_raw_a1`, `music_content_owner_asset_red_adjustment_revenue_raw_a1` | `parseRedSummaryFiles()` -> `writeMonthlySummary()`                                         | 저작권 월별 YouTube Premium/RED 수익과 조정분. composition metadata, claim quality, offer, monetized views, pro rata/per-sub-min revenue, partner revenue를 출력한다.              |
|         8 | `4_publishing_ddex_dsr.csv`     | `content_owner_claim_audio_tier_revenue_raw_a1`, `content_owner_claim_audio_tier_revenue_summary_a1`      | `parseAudioTierDetailFiles()` + `loadAudioTierSummaryRows()` -> `writeDdexDsr()`            | 저작권 DDEX DSR 형식 데이터. `HEAD`, `GSY09`, `SR02`, `SRFO` 레코드를 만들며 국가별 summary와 asset/date detail을 PerformingRight, MechanicalRight 두 권리 타입으로 출력한다.      |

저작권 단계도 `AssetClassifier`, `publishing_asset_ids.json`, `publishing_usage_cache.json`를 함께 사용한다. 저작권 대상 판정은 단일 CSV 컬럼이 아니라 `publishing_asset_ids.json`, custom id, metadata source category, ISWC/HFA/writers 등의 조합으로 이뤄진다.

## 3단계: Shorts 1개 파일

호출 위치: `src/extractPublishingShortsSummary.ts`의 `runPublishingShortsSummary()`

| 생성 순서 | 출력 파일                                 | 원천 report type                                | 처리 함수                         | 추출 데이터                                                                                                                                                                       |
| --------: | ----------------------------------------- | ----------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|         9 | `5_publishing_shorts_revenue_summary.csv` | `music_content_owner_shorts_revenue_summary_a1` | `parseCsvRows()` -> `writeRows()` | Shorts 수익 요약. payment period, country, monthly pool USD, pool participating rate, usage marketshare, flat fee revenue USD를 출력한다. flat fee revenue 내림차순으로 정렬한다. |

## 4단계: 정산 검증

9개 파일을 모두 만든 뒤 `src/validateSettlementPackage.ts`의 `runSettlementValidation()`이 실행된다.

검증 기준은 9개 클라이언트 패키지의 합계가 system-managed API 원천 합계와 맞는지다. 이 단계는 파일을 추가로 만들기보다, 누락/불일치가 있으면 명령을 실패시켜 패키지 생성이 완료되지 않은 것으로 처리한다.

## 최종 9개 파일 순서

클라이언트 패키지 관점에서 파일 순서는 다음과 같이 보면 된다.

1. `1_neighboring_daily_ad.csv`: 인접저작권 일별 광고 수익
2. `1_publishing_daily_ad.csv`: 저작권 광고 수익 및 usage bucket
3. `2_neighboring_daily_ad_adj.csv`: 인접저작권 광고 조정 수익
4. `2_publishing_daily_ad_adj.csv`: 저작권 광고 조정 수익
5. `3_neighboring_monthly_sub.csv`: 인접저작권 월별 Premium/RED 수익
6. `3_publishing_monthly_sub.csv`: 저작권 월별 Premium/RED 수익
7. `4_neighboring_financial_detail.csv`: 인접저작권 audio tier financial detail
8. `4_publishing_ddex_dsr.csv`: 저작권 audio tier DDEX DSR
9. `5_publishing_shorts_revenue_summary.csv`: 저작권 Shorts 수익 요약

주의할 점은 코드의 실제 실행 순서는 인접 4개를 먼저 쓰고, 그 다음 저작 4개, 마지막 Shorts 1개를 쓴다는 것이다. 위 최종 9개 파일 순서는 파일명 번호 기준으로 섞어 정리한 패키지 관점의 순서다.
