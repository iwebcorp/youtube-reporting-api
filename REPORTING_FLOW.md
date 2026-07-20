# Reporting Flow

이 문서는 명령어를 실행했을 때 어떤 프로세스가 돌고, 인접저작권/저작권 산출물의 각 컬럼이 어떤 API 원본 또는 로컬 캐시에서 오는지 정리한다.

## 전체 실행 순서

| 순서 | 명령어                                                      | 역할                                                         | 주요 입력                                                                                                                                | 주요 출력                                     |
| ---: | ----------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
|    1 | `npx tsx src/reAuth.ts`                                     | Google OAuth 토큰 생성/갱신                                  | `credentials.json`                                                                                                                       | `token.json`                                  |
|    2 | `npm run download-system-managed -- --yearMonth=YYYYMM`     | YouTube 시스템 관리 리포트 다운로드                          | YouTube Reporting API                                                                                                                    | `reports/system-managed/*.csv`                |
|    3 | `npm run build-metadata-cache -- --yearMonth=YYYYMM`        | 인접/저작 원본 디렉터리를 스캔해 asset metadata cache 재생성 | `reports_custom_id_YYYYMM/` 또는 `--neighboringDir`, `--publishingDir`                                                                   | `asset_metadata_cache.json`                   |
|  4-A | `npm run extract-csv -- --yearMonth=YYYYMM --outputDir=...` | 인접저작권 산출물 생성                                       | `reports/system-managed/*.csv`, `asset_metadata_cache.json`, `publishing_asset_ids.json`                                                 | `1_neighboring_*.csv` ~ `4_neighboring_*.csv` |
|  4-B | `npm run extract-pub -- --yearMonth=YYYYMM --outputDir=...` | 저작권 산출물 생성                                           | `reports/*.csv`, `reports/system-managed/*.csv`, `asset_metadata_cache.json`, `publishing_usage_cache.json`, `publishing_asset_ids.json` | `1_publishing_*.csv` ~ `4_publishing_*.csv`   |

기본 경로는 `config.json`과 CLI 옵션을 함께 사용한다. `--yearMonth=202605`처럼 넘기면 `resolveExtractionConfig()`가 월 단위 기본 디렉터리를 구성한다.

## API 사용 지점

### YouTube Reporting API

`src/downloadSystemManagedReports.ts`가 사용한다.

| API                                  | 코드상 호출                                                            | 용도                             |
| ------------------------------------ | ---------------------------------------------------------------------- | -------------------------------- |
| `youtubeReporting.jobs.list`         | `yt.jobs.list({ onBehalfOfContentOwner, includeSystemManaged: true })` | 시스템 관리 리포트 job 목록 조회 |
| `youtubeReporting.jobs.reports.list` | `yt.jobs.reports.list({ onBehalfOfContentOwner, jobId })`              | 각 job의 월별 report 목록 조회   |
| `report.downloadUrl`                 | `auth.request({ url: report.downloadUrl, responseType: "stream" })`    | 실제 CSV 파일 다운로드           |

기본 다운로드 대상 report type:

| report type id                                            | 사용처                                  |
| --------------------------------------------------------- | --------------------------------------- |
| `content_owner_asset_ad_revenue_raw_a1`                   | 인접/저작 일별 광고 수익                |
| `content_owner_asset_ad_adjustment_revenue_raw_a1`        | 인접/저작 광고 조정 수익                |
| `music_content_owner_asset_red_revenue_raw_a1`            | 인접/저작 월별 YouTube Premium/RED 수익 |
| `music_content_owner_asset_red_adjustment_revenue_raw_a1` | 인접/저작 월별 Premium/RED 조정 수익    |
| `content_owner_claim_audio_tier_revenue_raw_a1`           | 인접 financial detail, 저작 DDEX 상세   |
| `content_owner_claim_audio_tier_revenue_summary_a1`       | 저작 DDEX 국가별 summary fallback       |
| `music_content_owner_shorts_revenue_summary_a1`           | Shorts 관련 후속 산출용 다운로드 대상   |

### YouTube Content ID API / Partner API

주 추출 명령의 기본 컬럼 생성은 다운로드된 CSV와 로컬 cache를 사용한다. 별도 보강 스크립트가 Content ID API를 사용한다.

| 명령어                              | API                                                                            | 출력/캐시                         |
| ----------------------------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| `npm run fetch-asset-relationships` | `https://www.googleapis.com/youtube/partner/v1/assets?fetchMetadata=effective` | asset metadata 보강               |
| `npm run fetch-asset-relationships` | `https://www.googleapis.com/youtube/partner/v1/assetRelationships`             | parent/child, embedded 관계 cache |

## 공통 분류/메타데이터

`AssetClassifier`는 `src/reporting/metadata.ts`의 `AssetMetadataRepository`다.

| 판단/값                                                                                           | 출처                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 인접/저작 분류                                                                                    | `asset_metadata_cache.json`, `publishing_asset_ids.json`, custom id, ISRC/ISWC/HFA/writers 휴리스틱     |
| `Asset Title`, `Custom ID`, `ISRC`, `UPC`, `GRID`, `Artist`, `Album`, `Label`, `Writers` fallback | 원본 CSV에 값이 있으면 CSV 우선, 없으면 `asset_metadata_cache.json`, 그래도 없으면 `METADATA_FALLBACKS` |
| 저작 강제 포함                                                                                    | `publishing_asset_ids.json`에 asset id가 있으면 저작으로 판단                                           |

## 인접저작권 흐름

명령어:

```bash
npm run download-system-managed -- --yearMonth=YYYYMM
npm run build-metadata-cache -- --yearMonth=YYYYMM
npm run extract-csv -- --yearMonth=YYYYMM --outputDir=reports_final_neighboring_YYYYMM
```

`src/extractCsvs.ts`의 `runNeighboringExtraction()`이 다음 파일을 읽는다.

| 내부 변수            | report type id                                            | 처리 함수                                                           | 출력                                 |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| `adFiles`            | `content_owner_asset_ad_revenue_raw_a1`                   | `writeAdvertisingReports()` → `writeNeighboringAdRow()`             | `1_neighboring_daily_ad.csv`         |
| `adAdjustmentFiles`  | `content_owner_asset_ad_adjustment_revenue_raw_a1`        | `writeAdvertisingReports()` → `writeNeighboringAdRow()`             | `2_neighboring_daily_ad_adj.csv`     |
| `redFiles`           | `music_content_owner_asset_red_revenue_raw_a1`            | `parseRedSummaryFiles()` → `writeNeighboringMonthlySummary()`       | `3_neighboring_monthly_sub.csv`      |
| `redAdjustmentFiles` | `music_content_owner_asset_red_adjustment_revenue_raw_a1` | `parseRedSummaryFiles()` → `writeNeighboringMonthlySummary()`       | `3_neighboring_monthly_sub.csv`      |
| `audioTierFiles`     | `content_owner_claim_audio_tier_revenue_raw_a1`           | `parseAudioTierDetailFiles()` → `writeNeighboringFinancialDetail()` | `4_neighboring_financial_detail.csv` |

### 인접 1/2 광고 CSV 컬럼 출처

출력 파일:

- `1_neighboring_daily_ad.csv`
- `2_neighboring_daily_ad_adj.csv`

| 출력 컬럼                                             | 출처                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `Adjustment Type`                                     | 원본 `adjustment_type`, 없으면 `None`                                |
| `Day`                                                 | 원본 `day` 또는 `date`                                               |
| `Country`                                             | 원본 `country` 또는 `country_code`, 없으면 `XX`                      |
| `Asset ID`                                            | 원본 `asset_id`                                                      |
| `Asset Title`                                         | 원본 `asset_title`, 없으면 metadata cache                            |
| `Asset Labels`                                        | 현재 빈 값                                                           |
| `Asset Channel ID`                                    | 원본 `asset_channel_id` 또는 `channel_id`, 없으면 metadata cache     |
| `Asset Type`                                          | 원본 `asset_type`, 없으면 metadata cache                             |
| `Custom ID`                                           | 원본 `custom_id`, 없으면 metadata cache                              |
| `ISRC`                                                | 원본 `isrc`, 없으면 metadata cache                                   |
| `UPC`                                                 | 원본 `upc`, 없으면 metadata cache                                    |
| `GRid`                                                | 현재 빈 값                                                           |
| `Artist`                                              | 원본 `artist`, 없으면 metadata cache                                 |
| `Album`                                               | 원본 `album`, 없으면 metadata cache                                  |
| `Label`                                               | 원본 `label`, 없으면 metadata cache                                  |
| `Administer Publish Rights`                           | 고정값 `no`                                                          |
| `Owned Views`                                         | 원본 `owned_views`, 없으면 `0`                                       |
| `YouTube Revenue Split : Auction`                     | 원본 `youtube_revenue_split_auction`, 없으면 `0`                     |
| `YouTube Revenue Split : Reserved`                    | 원본 `youtube_revenue_split_reserved`, 없으면 `0`                    |
| `YouTube Revenue Split : Partner Sold YouTube Served` | 원본 `youtube_revenue_split_partner_sold_youtube_served`, 없으면 `0` |
| `YouTube Revenue Split : Partner Sold Partner Served` | 원본 `youtube_revenue_split_partner_sold_partner_served`, 없으면 `0` |
| `YouTube Revenue Split`                               | 원본 `youtube_revenue_split`, 없으면 `0`                             |
| `Partner Revenue : Auction`                           | 원본 `partner_revenue_auction`, 없으면 `0`                           |
| `Partner Revenue : Reserved`                          | 원본 `partner_revenue_reserved`, 없으면 `0`                          |
| `Partner Revenue : Partner Sold YouTube Served`       | 원본 `partner_revenue_partner_sold_youtube_served`, 없으면 `0`       |
| `Partner Revenue : Partner Sold Partner Served`       | 원본 `partner_revenue_partner_sold_partner_served`, 없으면 `0`       |
| `Partner Revenue`                                     | 원본 `partner_revenue`, 없으면 `0`                                   |

### 인접 3 월별 구독 CSV 컬럼 출처

출력 파일: `3_neighboring_monthly_sub.csv`

| 출력 컬럼                                   | 출처                                                       |
| ------------------------------------------- | ---------------------------------------------------------- |
| `Adjustment Type`                           | RED 원본 `adjustment type`, 없으면 `None`                  |
| `Month`                                     | CLI/config의 `yearMonth`                                   |
| `Country`                                   | RED 원본 `country` 또는 `country code`                     |
| `Asset ID`                                  | RED 원본 `asset id`                                        |
| `Asset Title`                               | RED 원본 `asset title/title`, 없으면 metadata cache        |
| `Asset Labels`                              | 현재 빈 값                                                 |
| `Asset Type`                                | RED 원본 `asset type`, 없으면 metadata cache               |
| `Custom ID`                                 | RED 원본 `custom id`, 없으면 metadata cache                |
| `ISRC`                                      | RED 원본 `isrc`, 없으면 metadata cache                     |
| `UPC`                                       | RED 원본 `upc`, 없으면 metadata cache                      |
| `GRID`                                      | RED 원본 `grid`                                            |
| `Artist`                                    | RED 원본 `artist`, 없으면 metadata cache                   |
| `Album`                                     | RED 원본 `album`, 없으면 metadata cache                    |
| `Label`                                     | RED 원본 `label`, 없으면 metadata cache                    |
| `Claim Type`                                | RED 원본 `claim type`, 없으면 `UGC`                        |
| `Content Type`                              | RED 원본 `content type`, 없으면 `Music`                    |
| `Offer`                                     | RED 원본 `offer`, 없으면 `YouTube Premium monthly`         |
| `Owned Views`                               | RED 원본 `owned views` 합산                                |
| `Monetized Views : Audio`                   | RED 원본 `monetized views audio` 합산                      |
| `Monetized Views : Audio Visual`            | RED 원본 `monetized views audio visual` 합산               |
| `Monetized Views`                           | RED 원본 `monetized views` 합산                            |
| `YouTube Revenue Split`                     | RED 원본 `youtube revenue split` 합산                      |
| `Partner Revenue : Pro Rata : Audio`        | RED 원본 `partner revenue pro rata audio` 합산             |
| `Partner Revenue : Pro Rata : Audio Visual` | RED 원본 `partner revenue pro rata audio visual` 합산      |
| `Partner Revenue : Pro Rata`                | RED 원본 `partner revenue pro rata` 합산                   |
| `Partner Revenue : Per Sub Min`             | RED 원본 `partner revenue per sub min` 합산                |
| `Partner Revenue`                           | RED 원본 `partner revenue usd` 또는 `partner revenue` 합산 |

### 인접 4 financial detail CSV 컬럼 출처

출력 파일: `4_neighboring_financial_detail.csv`

| 출력 컬럼                      | 출처                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| `Adjustment Type`              | 고정값 `None`                                              |
| `Date`                         | audio tier 원본 `date` 또는 `day`                          |
| `Country`                      | audio tier 원본 `country` 또는 `country code`              |
| `Video ID`                     | audio tier 원본 `video id`                                 |
| `Asset ID`                     | audio tier 원본 `asset id`                                 |
| `Asset Title`                  | audio tier 원본 `asset title/title`, 없으면 metadata cache |
| `Asset Labels`                 | 현재 빈 값                                                 |
| `Custom ID`                    | audio tier 원본 `custom id`, 없으면 metadata cache         |
| `ISRC`                         | audio tier 원본 `isrc`, 없으면 metadata cache              |
| `Upc`                          | audio tier 원본 `upc`, 없으면 metadata cache               |
| `Grid`                         | audio tier 원본 `grid`                                     |
| `Artist`                       | audio tier 원본 `artist`, 없으면 metadata cache            |
| `Album`                        | audio tier 원본 `album`, 없으면 metadata cache             |
| `Label`                        | audio tier 원본 `label`, 없으면 metadata cache             |
| `Owned Views`                  | audio tier 원본 `owned views`                              |
| `YouTube Revenue Split`        | audio tier 원본 `youtube revenue split`                    |
| `Partner Revenue Pro Rata`     | audio tier 원본 `partner revenue pro rata`                 |
| `Partner Revenue Per Play Min` | audio tier 원본 `partner revenue per play min`             |
| `Partner Revenue`              | audio tier 원본 `partner revenue`                          |

## 저작권 흐름

명령어:

```bash
npm run download-system-managed -- --yearMonth=YYYYMM
npm run build-metadata-cache -- --yearMonth=YYYYMM
npm run extract-pub -- --yearMonth=YYYYMM --outputDir=reports_final_publishing_YYYYMM
```

`src/extractPublishingCsvs.ts`의 `runPublishingExtraction()`이 다음 파일을 읽는다.

| 내부 변수               | report type id / source                                   | 처리 함수                                                                                 | 출력                            |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| `groups[].usageFiles`   | `reports/`의 `content_owner_asset_combined_a3`            | `buildPublishingUsageCacheFromReports()`                                                  | 광고 CSV의 view bucket          |
| `financialFiles`        | `content_owner_asset_ad_revenue_raw_a1`                   | `parsePublishingFinancialFiles()` → `buildMonthlyAdSummary()` → `writeMonthlyAdSummary()` | `1_publishing_daily_ad.csv`     |
| `adjustmentFiles`       | `content_owner_asset_ad_adjustment_revenue_raw_a1`        | `writeFinancialAdjustments()` → `writeAdjustmentRow()`                                    | `2_publishing_daily_ad_adj.csv` |
| `redFiles`              | `music_content_owner_asset_red_revenue_raw_a1`            | `parseRedSummaryFiles()` → `writeMonthlySummary()`                                        | `3_publishing_monthly_sub.csv`  |
| `redAdjustmentFiles`    | `music_content_owner_asset_red_adjustment_revenue_raw_a1` | `parseRedSummaryFiles()` → `writeMonthlySummary()`                                        | `3_publishing_monthly_sub.csv`  |
| `audioTierFiles`        | `content_owner_claim_audio_tier_revenue_raw_a1`           | `parseAudioTierDetailFiles()` → `writeDdexDsr()`                                          | `4_publishing_ddex_dsr.csv`     |
| `audioTierSummaryFiles` | `content_owner_claim_audio_tier_revenue_summary_a1`       | `loadAudioTierSummaryRows()` → `writeDdexDsr()` fallback summary                          | `4_publishing_ddex_dsr.csv`     |

주의: 코드 주석상 저작권 추출은 현재 “API-only raw fallback”이다. Embedded/Cover 분류와 Mechanical/Performance 확장 로직은 완전 자동화 전 단계로 남아 있다.

### 저작 1 광고 CSV 컬럼 출처

출력 파일: `1_publishing_daily_ad.csv`

| 출력 컬럼                                                 | 출처                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `Asset ID`                                                | ad revenue 원본 `asset id`                                          |
| `Asset Labels`                                            | 현재 빈 값                                                          |
| `Custom ID`                                               | ad revenue 원본 `custom id`, 없으면 metadata cache                  |
| `ISWC`                                                    | metadata cache                                                      |
| `HFA Song Code`                                           | metadata cache                                                      |
| `Asset Title`                                             | ad revenue 원본 `asset title/title`, 없으면 metadata cache          |
| `Writers`                                                 | metadata cache                                                      |
| `Music Claim Type`                                        | 현재 raw fallback에서 고정값 `unknown`                              |
| `Composition Right Type`                                  | metadata cache, fallback `Mechanical; Performing`                   |
| `Ownership Percentage`                                    | 고정값 `100.00`                                                     |
| `Country`                                                 | ad revenue 원본 `country/country code`                              |
| `Owned Views`                                             | ad revenue 원본 `owned views` 또는 usage report derived total       |
| `Owned Views : Watch Page`                                | usage report `playback location type` 기반 watch bucket             |
| `Owned Views : Embedded Player`                           | usage report `playback location type` 기반 embedded bucket          |
| `Owned Views : Channel Page`                              | usage report `playback location type` 기반 channel bucket           |
| `Owned Views : Live`                                      | usage report `live or on demand` 값이 `LIVE`인 views                |
| `Owned Views : On Demand`                                 | usage report `live or on demand` 값이 `ON_DEMAND`인 views           |
| `Owned Views : Ad-Enabled`                                | usage report `views - red views`                                    |
| `YouTube Revenue Split : AdSense Served YouTube Sold`     | ad revenue 원본 `youtube revenue split auction`                     |
| `YouTube Revenue Split : DoubleClick Served YouTube Sold` | ad revenue 원본 `youtube revenue split reserved`                    |
| `YouTube Revenue Split : DoubleClick Served Partner Sold` | ad revenue 원본 `youtube revenue split partner sold youtube served` |
| `YouTube Revenue Split : Partner Served Partner Sold`     | ad revenue 원본 `youtube revenue split partner sold partner served` |
| `YouTube Revenue Split`                                   | ad revenue 원본 `youtube revenue split`                             |
| `Partner Revenue : AdSense Served YouTube Sold`           | ad revenue 원본 `partner revenue auction`                           |
| `Partner Revenue : DoubleClick Served YouTube Sold`       | ad revenue 원본 `partner revenue reserved`                          |
| `Partner Revenue : DoubleClick Served Partner Sold`       | ad revenue 원본 `partner revenue partner sold youtube served`       |
| `Partner Revenue : Partner Served Partner Sold`           | ad revenue 원본 `partner revenue partner sold partner served`       |
| `Partner Revenue`                                         | ad revenue 원본 `partner revenue`                                   |

### 저작 2 광고 조정 CSV 컬럼 출처

출력 파일: `2_publishing_daily_ad_adj.csv`

| 출력 컬럼                                             | 출처                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Adjustment Type`                                     | adjustment 원본 `adjustment_type`; `None`은 제외                                |
| `Day`                                                 | adjustment 원본 `day` 또는 `date`                                               |
| `Country`                                             | adjustment 원본 `country` 또는 `country_code`                                   |
| `Asset ID`                                            | adjustment 원본 `asset_id`                                                      |
| `Asset Title`                                         | adjustment 원본 `asset_title/title`, 없으면 metadata cache                      |
| `Asset Labels`                                        | 현재 빈 값                                                                      |
| `Asset Channel ID`                                    | adjustment 원본 `asset_channel_id`                                              |
| `Asset Type`                                          | adjustment 원본 `asset_type`, 없으면 metadata cache 또는 `Composition`          |
| `Custom ID`                                           | adjustment 원본 `custom_id`, 없으면 metadata cache                              |
| `ISRC`                                                | adjustment 원본 `isrc`, 없으면 metadata cache                                   |
| `ISWC`                                                | adjustment 원본 `iswc`, 없으면 metadata cache                                   |
| `HFA Song Code`                                       | adjustment 원본 `hfa_song_code/hfa`, 없으면 metadata cache                      |
| `Writers`                                             | metadata cache                                                                  |
| `Owned Views`                                         | adjustment 원본 `owned_views`, 없으면 `0`                                       |
| `YouTube Revenue Split : Auction`                     | adjustment 원본 `youtube_revenue_split_auction`, 없으면 `0`                     |
| `YouTube Revenue Split : Reserved`                    | adjustment 원본 `youtube_revenue_split_reserved`, 없으면 `0`                    |
| `YouTube Revenue Split : Partner Sold YouTube Served` | adjustment 원본 `youtube_revenue_split_partner_sold_youtube_served`, 없으면 `0` |
| `YouTube Revenue Split : Partner Sold Partner Served` | adjustment 원본 `youtube_revenue_split_partner_sold_partner_served`, 없으면 `0` |
| `YouTube Revenue Split`                               | adjustment 원본 `youtube_revenue_split`, 없으면 `0`                             |
| `Partner Revenue : Auction`                           | adjustment 원본 `partner_revenue_auction`, 없으면 `0`                           |
| `Partner Revenue : Reserved`                          | adjustment 원본 `partner_revenue_reserved`, 없으면 `0`                          |
| `Partner Revenue : Partner Sold YouTube Served`       | adjustment 원본 `partner_revenue_partner_sold_youtube_served`, 없으면 `0`       |
| `Partner Revenue : Partner Sold Partner Served`       | adjustment 원본 `partner_revenue_partner_sold_partner_served`, 없으면 `0`       |
| `Partner Revenue`                                     | adjustment 원본 `partner_revenue`, 없으면 `0`                                   |

### 저작 3 월별 구독 CSV 컬럼 출처

출력 파일: `3_publishing_monthly_sub.csv`

| 출력 컬럼                                   | 출처                                                          |
| ------------------------------------------- | ------------------------------------------------------------- |
| `Adjustment Type`                           | RED 원본 `adjustment type`, 없으면 `None`                     |
| `Month`                                     | CLI/config의 `yearMonth`                                      |
| `Country`                                   | RED 원본 `country` 또는 `country code`                        |
| `Asset ID`                                  | RED 원본 `asset id`                                           |
| `Asset Title`                               | metadata cache                                                |
| `Asset Labels`                              | 현재 빈 값                                                    |
| `Custom ID`                                 | metadata cache                                                |
| `ISRC`                                      | metadata cache                                                |
| `ISWC`                                      | metadata cache                                                |
| `HFA Song Code`                             | metadata cache                                                |
| `Writers`                                   | metadata cache                                                |
| `Composition Right Type`                    | metadata cache                                                |
| `Ownership Percentage`                      | 고정값 `100.00`                                               |
| `Claim Quality`                             | RED 원본 `claim type`, 없으면 `UGC`                           |
| `Revshare Rate Type`                        | 고정값 `Unknown`                                              |
| `Offer`                                     | RED 원본 `offer`, 없으면 `YouTube Premium Individual monthly` |
| `Owned Views`                               | RED 원본 `owned views` 합산                                   |
| `Monetized Views : Audio`                   | RED 원본 `monetized views audio` 합산                         |
| `Monetized Views : Audio Visual`            | RED 원본 `monetized views audio visual` 합산                  |
| `Monetized Views`                           | RED 원본 `monetized views` 합산                               |
| `YouTube Revenue Split`                     | RED 원본 `youtube revenue split` 합산                         |
| `Partner Revenue : Pro Rata : Audio`        | RED 원본 `partner revenue pro rata audio` 합산                |
| `Partner Revenue : Pro Rata : Audio Visual` | RED 원본 `partner revenue pro rata audio visual` 합산         |
| `Partner Revenue : Pro Rata`                | RED 원본 `partner revenue pro rata` 합산                      |
| `Partner Revenue : Per Sub Min`             | RED 원본 `partner revenue per sub min` 합산                   |
| `Partner Revenue`                           | RED 원본 `partner revenue usd` 또는 `partner revenue` 합산    |

### 저작 4 DDEX DSR 컬럼/레코드 출처

출력 파일: `4_publishing_ddex_dsr.csv`

이 파일은 일반 CSV가 아니라 탭 구분 DDEX 스타일 레코드다.

| 레코드                              | 주요 필드                                                      | 출처                                                                                      |
| ----------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `HEAD`                              | 기간, sender/recipient, service description                    | `yearMonth`, 실행 시각, 코드 고정값                                                       |
| `#HEAD`, `#GSY09`, `#SR02`, `#SRFO` | 헤더 라인                                                      | 코드 고정값                                                                               |
| `GSY09`                             | Territory, Usages, AllocatedAmount, RightsType                 | audio tier detail 집계, summary 파일 fallback, 권리 타입은 Mechanical/Performing 2줄 생성 |
| `SR02`                              | asset id, title, artist/writer, ISRC, ISWC, usage date, amount | audio tier raw detail + metadata cache                                                    |
| `SRFO`                              | 전체 라인 수, summary record 수                                | 생성된 detail/country row 수 계산                                                         |

`SR02`는 각 detail row마다 `PerformingRight`, `MechanicalRight` 두 줄을 만든다. 금액은 현재 각 권리 타입 줄에 `detail.partnerRevenue`를 그대로 쓴다.

## 자주 헷갈리는 포인트

## 추가로 뽑을 수 있는 값

현재 산출물은 정산 제출 형식에 필요한 컬럼 위주로 쓰지만, 원본 CSV/API에는 후속 분석이나 검증에 쓸 수 있는 값이 더 있다. 아래 값들은 새 출력 컬럼을 추가하거나 별도 audit/report CSV를 만들 때 후보가 된다.

### 광고 수익 원본에서 추가 가능

원본 report type:

- `content_owner_asset_ad_revenue_raw_a1`
- `content_owner_asset_ad_adjustment_revenue_raw_a1`

이미 대부분의 광고 수익 컬럼은 인접/저작 산출물에 들어간다. 그래도 현재 코드에서 비우거나 고정값으로 처리하는 항목은 원본에서 바로 복구할 수 있다.

| 추가/개선 후보 | 원본 컬럼 | 현재 상태 | 쓸 수 있는 용도 |
|---|---|---|---|
| Asset Labels | `asset_labels` | 현재 출력에서 빈 값 | 레이블별 정산 검증, 카탈로그 그룹핑 |
| Administer Publish Rights | `administer_publish_rights` | 인접은 `no` 고정, 저작은 미사용 | 권리 관리 여부 확인 |
| GRID/GRid | `grid` | 일부 출력에서 빈 값 | 저작/인접 식별 보조, DDEX work id fallback |
| 원본 날짜 구분 | `date` 또는 `day` | 출력 날짜로만 사용 | 월 경계/adjustment 기간 검증 |
| 원본 asset channel | `asset_channel_id` | 일부 산출물만 사용 | 채널별 정산/검증 |
| 원본 asset labels + custom id 조합 | `asset_labels`, `custom_id` | 분류 보조로 제한적 사용 | 인접/저작 오분류 audit |

### RED/Premium 월별 원본에서 추가 가능

원본 report type:

- `music_content_owner_asset_red_revenue_raw_a1`
- `music_content_owner_asset_red_adjustment_revenue_raw_a1`

| 추가/개선 후보 | 원본 컬럼 | 현재 상태 | 쓸 수 있는 용도 |
|---|---|---|---|
| Asset Labels | `asset_labels` | 현재 출력에서 빈 값 | 레이블별 구독 수익 검증 |
| Claim Type | `claim_type` | 인접/저작 일부 출력에 사용 | UGC/claim quality audit |
| Content Type | `content_type` | 인접 출력에 사용, 저작은 별도 고정/대체 | Music/기타 콘텐츠 분리 |
| Offer | `offer` | 출력에 사용 | Premium 상품/요금제별 분해 |
| Audio vs Audio Visual split | `monetized_views_audio`, `monetized_views_audio_visual`, `partner_revenue_pro_rata_audio`, `partner_revenue_pro_rata_audio_visual` | 출력에 사용 | 오디오/영상 기여도 분석 |
| Per-sub-min 수익 | `partner_revenue_per_sub_min` | 출력에 사용 | pro-rata와 minimum 보전액 비교 |
| Adjustment 여부 | `adjustment_type` | 출력에 사용 | 일반 월별 수익과 조정분 별도 audit |

### Audio Tier detail에서 추가 가능

원본 report type:

- `content_owner_claim_audio_tier_revenue_raw_a1`

| 추가/개선 후보 | 원본 컬럼 | 현재 상태 | 쓸 수 있는 용도 |
|---|---|---|---|
| Video ID | `video_id` | 인접 financial detail에 사용, 저작 DDEX에는 미사용 | 영상 단위 정산 추적 |
| Asset Labels | `asset_labels` | 현재 출력에서 빈 값 | 레이블별 audio tier 검증 |
| GRID | `grid` | 인접 detail/DDEX fallback에 사용 | work id 보강 |
| Partner revenue split | `partner_revenue_pro_rata`, `partner_revenue_per_play_min`, `partner_revenue` | 인접 detail에 사용, 저작 DDEX 금액에 사용 | pro-rata와 per-play-min 분해 |
| 날짜별 detail | `date` | 인접 detail/DDEX 사용 | 일별 DDEX/audit 리포트 |
| artist/album/label | `artist`, `album`, `label` | 인접 detail에 사용, 저작은 metadata 중심 | 음원 메타데이터 검증 |

### Audio Tier summary에서 추가 가능

원본 report type:

- `content_owner_claim_audio_tier_revenue_summary_a1`

| 추가/개선 후보 | 원본 컬럼 | 현재 상태 | 쓸 수 있는 용도 |
|---|---|---|---|
| 기간 | `start_date`, `end_date` | DDEX HEAD는 `yearMonth`로 계산 | 실제 report coverage 검증 |
| 통화 | `currency` | DDEX는 `USD` 고정 | 다통화/환율 검증 |
| 국가 | `country` | DDEX summary fallback key | 국가별 summary 검증 |
| 최소 보장 단가 | `per_play_minimum`, `per_play_minimum_currency` | 현재 산출물에는 직접 미노출 | per-play-min 계산 audit |
| 환율 | `usd_local_rate` | 현재 산출물에는 직접 미노출 | 원화/현지통화 환산 검증 |
| playback 총량 | `partner_playbacks`, `Total Playbacks` | DDEX fallback summary로만 사용 | detail 합계와 summary 대사 |
| 광고 revshare | `partner_audio_ad_revshare_rate`, `partner_audio_ad_revshare` | 현재 산출물에는 직접 미노출 | audio 광고 수익률 검증 |
| audio royalty | `audio_royalties` | DDEX fallback amount로 사용 | 국가별 royalty 총액 대사 |

### Usage report에서 추가 가능

원본 report type:

- `content_owner_asset_combined_a3`

현재 저작 광고 CSV에서 view bucket 일부만 사용한다. 원본에는 사용자/재생 환경별 분석용 차원이 더 있다.

| 추가/개선 후보 | 원본 컬럼 | 현재 상태 | 쓸 수 있는 용도 |
|---|---|---|---|
| Channel ID | `channel_id` | 현재 저작 view bucket에는 미노출 | 채널별 조회/수익 audit |
| Video ID | `video_id` | usage 집계에서 일부 구조만 사용 | 영상별 조회수 검증 |
| Claimed Status | `claimed_status` | 미사용 | claim 상태별 제외/검증 |
| Uploader Type | `uploader_type` | 미사용 | partner/user upload 구분 |
| Subscription Status | `subscribed_status` | 미사용 | 구독자/비구독자 조회 분해 |
| Traffic Source Type | `traffic_source_type` | 미사용 | 유입 경로 분석 |
| Device Type | `device_type` | 미사용 | 기기별 소비 분석 |
| Operating System | `operating_system` | 미사용 | OS별 소비 분석 |
| Engaged Views | `engaged_views` | 미사용 | 단순 views보다 품질 지표로 활용 |
| Watch Time | `watch_time_minutes` | 미사용 | 시청시간 기반 검증/분석 |
| Average View Duration | `average_view_duration_seconds`, `average_view_duration_percentage` | 미사용 | 평균 시청 지속시간 분석 |
| RED watch time | `red_watch_time_minutes` | 미사용 | Premium 조회와 시청시간 대사 |

### Metadata/Partner API에서 추가 가능

`fetchAssetRelationships.ts`는 Partner API로 asset metadata와 relationship을 캐시할 수 있다.

| 추가/개선 후보 | API/캐시 필드 | 현재 상태 | 쓸 수 있는 용도 |
|---|---|---|---|
| Asset type | `assets[].type` | metadata cache 일부 사용 | sound recording/composition 구분 |
| Effective metadata 전체 | `assets[].metadata` | 주요 필드만 정규화 | 누락 필드 조사, 원본 API audit |
| Artists 배열 | `metadata.artist` | 문자열 fallback 중심 | 복수 artist 보존 |
| Writers 배열 | `metadata.writers` | 문자열 fallback 중심 | 작가별 지분/정산 확장 |
| Composition right type | `metadata.compositionRightType` | 저작 출력에 사용 | mechanical/performing 분리 개선 |
| Asset relationships | `assetRelationships` items | 별도 cache로 저장 | parent/child, embedded/cover 분류 자동화 |
| Related asset metadata | relationship 관련 asset metadata | cache 저장 | 저작 대상 asset과 녹음 asset 연결 |

### 다음에 만들면 좋은 보조 산출물

| 후보 파일 | 목적 | 원본 |
|---|---|---|
| `asset_classification_audit.csv` | asset id별 인접/저작 분류 근거를 표시 | metadata cache, `publishing_asset_ids.json`, custom id |
| `source_column_coverage.csv` | 원본 report type별 컬럼 존재/빈값 비율 확인 | system-managed CSV 전체 |
| `usage_breakdown_by_device.csv` | 기기/OS/traffic source별 조회수 분석 | `content_owner_asset_combined_a3` |
| `audio_tier_summary_reconcile.csv` | audio tier detail 합계와 summary 총액 대사 | audio tier raw + summary |
| `relationship_audit.csv` | parent/child/embedded 관계 확인 | Partner API relationship cache |

1. `download-system-managed`는 API에서 CSV를 내려받는 단계이고, `extract-csv`/`extract-pub`는 이미 받은 CSV를 가공하는 단계다.
2. 인접/저작 구분은 단일 API 컬럼 하나로만 결정하지 않는다. `publishing_asset_ids.json`, source directory, custom id, metadata의 ISRC/ISWC/HFA/writers를 함께 본다.
3. `Asset Labels`, 일부 `GRID/GRid`, `Administer Publish Rights`, `Ownership Percentage`, `Revshare Rate Type`처럼 현재 코드에서 빈 값 또는 고정값으로 쓰는 컬럼이 있다.
4. 저작권 산출물은 코드 주석상 아직 Embedded/Cover 분류 자동화가 완성되지 않은 raw fallback 흐름이다. 정산 릴리스 전에는 `validate-*` 명령과 룰북 확인이 필요하다.
