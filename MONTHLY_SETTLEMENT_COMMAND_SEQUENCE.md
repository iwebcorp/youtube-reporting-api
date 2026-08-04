# 월별 정산 수동 명령어 실행 순서

## 1. 문서 목적

이 문서는 `run-monthly-settlement.cmd`와 `npm.cmd run monthly-settlement` 통합 실행기를 사용하지 않고, PowerShell에서 월별 정산 단계를 하나씩 직접 실행하는 순서를 설명한다.

모든 명령은 프로젝트 루트에서 실행한다.

```powershell
Set-Location C:\Users\iweb\youtube-API-prototype
```

`npm.cmd`는 이 프로젝트의 통합 실행 파일이 아니라 Windows에서 npm을 실행하는 프로그램이다.

### 2026년 6월 기준 예상 파일 용량

아래 용량은 로컬에 저장된 `202606` 실제 파일을 측정한 참고값이다. 조회수, 정산 행 수와 YouTube 보고서 구성에 따라 월마다 달라질 수 있다.

일별 raw data의 용량은 다음과 같다.

| raw data 종류 | 파일 수 | 파일당 평균 | 월 전체 |
| --- | ---: | ---: | ---: |
| `content_owner_asset_combined_a3` | 30개 | 약 82.57MB | 약 2.42GB |
| `content_owner_asset_estimated_revenue_a1` | 30개 | 약 5.27MB | 약 158.22MB |
| raw data 합계 | 60개 | - | 약 2.57GB |

일반 Content Owner system-managed data의 용량은 다음과 같다.

| system-managed 파일 종류 | 약 용량 |
| --- | ---: |
| `content_owner_asset_ad_revenue_raw_a1` | 212.19MB |
| `content_owner_asset_ad_adjustment_revenue_raw_a1` | 0.32MB |
| `music_content_owner_asset_red_revenue_raw_a1` | 83.05MB |
| `music_content_owner_asset_red_adjustment_revenue_raw_a1` | 0.04MB |
| `content_owner_claim_audio_tier_revenue_raw_a1` | 1.69MB |
| `content_owner_claim_audio_tier_revenue_summary_a1` | 0.01MB 미만 |
| `music_content_owner_shorts_revenue_summary_a1` | 0.01MB |
| `content_owner_asset_a3` 월말 스냅샷 | 약 7.76MB |
| 일반 system-managed 합계 | 약 297.29MB |

수동 명령에서 지정해 다운로드하는 PLA system-managed data의 용량은 다음과 같다.

| PLA system-managed 파일 종류 | 약 용량 |
| --- | ---: |
| `content_owner_asset_ad_revenue_raw_a1` | 19.75MB |
| `content_owner_asset_ad_adjustment_revenue_raw_a1` | 0.08MB |
| `publisher_content_owner_music_asset_red_revenue_raw_a1` | 12.12MB |
| `publisher_content_owner_asset_red_adjustment_revenue_raw_a1` | 0.64MB |
| `content_owner_payments_summary_a1` | 0.01MB 미만 |
| 지정 PLA system-managed 합계 | 약 32.6MB |

최종 산출물의 용량은 다음과 같다.

| 최종 파일 | 약 용량 |
| --- | ---: |
| `1_neighboring_daily_ad.csv` | 224.91MB |
| `2_neighboring_daily_ad_adj.csv` | 0.35MB |
| `3_neighboring_monthly_sub.csv` | 54.75MB |
| `4_neighboring_financial_detail.csv` | 2.02MB |
| `1_publishing_daily_ad.csv` | 2.13MB |
| `2_publishing_daily_ad_adj.csv` | 0.08MB |
| `3_publishing_monthly_sub.csv` | 2.53MB |
| `5_publishing_shorts_revenue_summary.csv` | 0.01MB |
| `6_shorts_video_usage_detail.csv` | 약 15.88MB |
| 최종 9개 파일 합계 | 약 302.65MB |
| `publishing_ge_summary.csv` | 약 268바이트 |

모든 파일을 합친 용량은 다음과 같다.

| 구분 | 파일 수 | 실제 합계 |
| --- | ---: | ---: |
| 일별 raw data | 60개 | 약 2.57GiB |
| 일반 system-managed data | 7개 | 약 0.29GiB |
| 지정 PLA system-managed data | 5개 | 약 0.03GiB |
| 자산 메타데이터 월말 스냅샷 | 1개 | 약 0.008GiB |
| 최종 9개 전달 파일 | 9개 | 약 0.30GiB |
| GE summary | 1개 | 268바이트 |
| 전체 합계 | 83개 | 약 `3,434,861,906바이트` |

전체 합계는 약 `3,434.86MB`, Windows 용량 표기 기준으로 약 `3,275.74MiB`, 즉 약 `3.20GiB`다. Shorts 중간 산출물과 월별 변동을 고려해 최소 4GB 이상의 여유 공간을 확보한다.

수동 실행 순서는 다음과 같다.

1. 일별 raw data 다운로드.
2. 일반 Content Owner system-managed data 다운로드.
3. 일반 Content Owner 자산 메타데이터 월말 스냅샷 다운로드.
4. PLA Content Owner system-managed data와 Payment Summary 다운로드.
5. Neighboring 1~4 생성.
6. Publishing 1~3 생성.
7. Shorts 수익 요약 생성.
8. Shorts Video Usage 생성 및 메타데이터 보강.
9. 8개 정산 파일 합계 검증.
10. GE summary 생성.
11. 최종 파일 존재 여부 확인.

각 명령이 오류 없이 끝난 것을 확인한 뒤 다음 명령을 실행한다. 앞 단계가 실패하면 다음 단계를 실행하지 않는다.

## 2. 대상 월과 경로 설정

PowerShell에서 대상 월과 출력 경로를 설정한다.

```powershell
$YEAR_MONTH = "202607"
$PACKAGE_DIR = "reports_final_${YEAR_MONTH}_client_pla_9files"
$GE_DIR = "reports_final_${YEAR_MONTH}_publishing_ge"
$ASSET_METADATA_DIR = "reports/system-managed-assets"
$SHORTS_RAW_DIR = "reports/shorts-usage-${YEAR_MONTH}"
$GENERAL_CONTENT_OWNER_ID = "2jFu0i9K0PE3MDrkU_UUfQ"
$PLA_CONTENT_OWNER_ID = "C9wllE5I6sRtJdunaUAdqQ"
$PLA_REPORT_TYPES = "content_owner_asset_ad_revenue_raw_a1,content_owner_asset_ad_adjustment_revenue_raw_a1,publisher_content_owner_music_asset_red_revenue_raw_a1,publisher_content_owner_asset_red_adjustment_revenue_raw_a1,content_owner_payments_summary_a1"
```

PowerShell 창을 닫으면 위 변수는 사라지므로 새 창에서는 다시 입력한다.

## 3. 1단계: 일별 raw data 다운로드

YouTube Reporting API의 대상 월 일별 raw data를 `reports/`에 다운로드한다.

```powershell
npm.cmd run get-reports -- --yearMonth=$YEAR_MONTH --reportDir=reports
```

주요 사용 데이터는 `content_owner_asset_combined_a3` 일별 CSV다.

## 4. 2단계: 일반 system-managed data 다운로드

Neighboring 1~4와 Shorts 생성에 필요한 일반 Content Owner 보고서를 `reports/system-managed/`에 다운로드한다.

```powershell
npm.cmd run download-system-managed -- --yearMonth=$YEAR_MONTH --contentOwnerId=$GENERAL_CONTENT_OWNER_ID --systemManagedDir=reports/system-managed
```

## 5. 3단계: 자산 메타데이터 월말 스냅샷 다운로드

Shorts 상세의 곡명, Custom ID와 ISRC 보강에 사용할 월말 스냅샷 한 개만 다운로드한다.

```powershell
npm.cmd run download-system-managed -- --yearMonth=$YEAR_MONTH --contentOwnerId=$GENERAL_CONTENT_OWNER_ID --systemManagedDir=$ASSET_METADATA_DIR --reportTypeIds=content_owner_asset_a3 --latestOnly
$ASSET_METADATA_FILE = Get-ChildItem -Path $ASSET_METADATA_DIR -Filter "${YEAR_MONTH}_content_owner_asset_a3_*.csv" | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
```

## 6. 4단계: PLA system-managed data 다운로드

Publishing 1~3과 GE summary에 필요한 PLA 보고서 및 Payment Summary를 `reports/system-managed-pla/`에 다운로드한다.

```powershell
npm.cmd run download-system-managed -- --yearMonth=$YEAR_MONTH --contentOwnerId=$PLA_CONTENT_OWNER_ID --systemManagedDir=reports/system-managed-pla --reportTypeIds=$PLA_REPORT_TYPES
```

이 단계가 끝나기 전에는 Publishing과 GE 추출을 실행하지 않는다.

## 7. 5단계: Neighboring 1~4 생성

같은 최종 패키지 폴더에 Neighboring 파일 4개를 생성한다.

```powershell
npm.cmd run extract-csv -- --yearMonth=$YEAR_MONTH --reportDir=reports --systemManagedDir=reports/system-managed --outputDir=$PACKAGE_DIR
```

생성 파일은 다음과 같다.

```text
1_neighboring_daily_ad.csv
2_neighboring_daily_ad_adj.csv
3_neighboring_monthly_sub.csv
4_neighboring_financial_detail.csv
```

## 8. 6단계: Publishing 1~3 생성

Neighboring 파일이 들어 있는 동일한 패키지 폴더에 Publishing 파일 3개를 추가한다.

```powershell
npm.cmd run extract-pub -- --yearMonth=$YEAR_MONTH --reportDir=reports --systemManagedDir=reports/system-managed --publishingSystemManagedDir=reports/system-managed-pla --outputDir=$PACKAGE_DIR
```

생성 파일은 다음과 같다.

```text
1_publishing_daily_ad.csv
2_publishing_daily_ad_adj.csv
3_publishing_monthly_sub.csv
```

`4_publishing_ddex_dsr.csv`는 Reporting API에서 제공되지 않으므로 생성하지 않는다.

## 9. 7단계: Shorts 수익 요약 생성

같은 패키지 폴더에 Shorts 파일을 추가한다.

```powershell
npm.cmd run extract-publishing-shorts -- --yearMonth=$YEAR_MONTH --systemManagedDir=reports/system-managed --outputDir=$PACKAGE_DIR
```

생성 파일은 다음과 같다.

```text
5_publishing_shorts_revenue_summary.csv
```

이 단계까지 완료하면 정산 합계 대상 파일 8개가 생성된다.

## 10. 8단계: Shorts Video Usage 생성 및 보강

Video ID별 Shorts Views와 Engaged Views 상세를 생성하고 자산 메타데이터를 보강한다.

```powershell
npm.cmd run extract-shorts-song-data -- --yearMonth=$YEAR_MONTH --reportDir=reports --outputDir=$SHORTS_RAW_DIR
npm.cmd run enrich-shorts-song-data -- --inputFile="$SHORTS_RAW_DIR/shorts_video_usage_detail_${YEAR_MONTH}.csv" --assetMetadataFile=$ASSET_METADATA_FILE --outputFile="$PACKAGE_DIR/6_shorts_video_usage_detail.csv"
```

`6_shorts_video_usage_detail.csv`는 검증 참고파일이며 정산 합계에 더하지 않는다.

## 11. 9단계: 8개 정산 파일 검증

Neighboring 1~4, Publishing 1~3, Shorts의 합계와 API 원천 합계를 비교한다.

```powershell
npm.cmd run validate-settlement-package -- --yearMonth=$YEAR_MONTH --systemManagedDir=reports/system-managed --publishingSystemManagedDir=reports/system-managed-pla --outputDir=$PACKAGE_DIR
```

정상 결과의 핵심 조건은 다음과 같다.

```text
difference=0.000000000
```

차이가 0이 아니면 클라이언트 전달 전에 원인을 확인한다.

## 12. 10단계: GE summary 생성

PLA Payment Summary와 Publishing 음악 상세 합계의 차액으로 GE 총액 요약을 별도 폴더에 생성한다.

```powershell
npm.cmd run extract-publishing-ge -- --yearMonth=$YEAR_MONTH --publishingSystemManagedDir=reports/system-managed-pla --outputDir=$GE_DIR
```

생성 파일은 다음과 같다.

```text
publishing_ge_summary.csv
```

GE 상세 내역은 YouTube에서 제공하지 않으므로 이 파일은 총액 요약만 포함한다.

## 13. 최종 산출물 확인

정산 파일 8개와 Shorts Video Usage 참고파일을 포함한 패키지 9개 파일을 확인한다.

```powershell
Get-ChildItem -Path $PACKAGE_DIR -File | Select-Object Name, Length
```

GE 요약 파일을 확인한다.

```powershell
Get-ChildItem -Path $GE_DIR -File | Select-Object Name, Length
```

최종 전달 대상은 다음 두 폴더다.

```text
reports_final_YYYYMM_client_pla_9files/
reports_final_YYYYMM_publishing_ge/
```

## 14. 수동 실행 시 주의사항

- 이 문서의 실행에서는 `run-monthly-settlement.cmd`와 `npm.cmd run monthly-settlement`를 사용하지 않는다.
- 3절부터 12절까지의 명령을 위에서 아래로 한 번씩 실행한다.
- 명령 하나가 실패하면 원인을 해결하기 전까지 다음 명령을 실행하지 않는다.
- 기존에 승인된 결과 폴더를 `outputDir`로 지정하지 않는다.
- 다른 월을 실행할 때는 `$YEAR_MONTH`만 변경하고 나머지 경로 규칙은 유지한다.
