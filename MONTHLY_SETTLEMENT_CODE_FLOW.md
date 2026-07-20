# 월별 정산 필수 코드 파일

이 문서는 월별 정산 프로세스에서 실제로 실행되거나 import되는 코드 파일만 정리한다.

## 1. 월별 실행 순서

| 순서 | 직접 실행하는 코드 파일 | 역할 |
| ---: | --- | --- |
| 1 | `src/getReports.ts` | 대상 월의 일별 Reporting API raw data를 다운로드한다. |
| 2 | `src/downloadSystemManagedReports.ts` | 일반 Content Owner의 system-managed 보고서를 다운로드한다. |
| 3 | `src/downloadSystemManagedReports.ts` | PLA Content Owner ID와 별도 저장 경로를 지정하여 PLA system-managed 보고서를 다운로드한다. |
| 4 | `src/extractMonthlyClientPackage.ts` | Neighboring 1~4, Publishing 1~3, Shorts를 생성하고 정산 합계를 검증한다. |
| 5 | 수동 처리 | PLA CMS에서 받은 공식 Hardware Audio Tier DSR을 `4_publishing_ddex_dsr.csv`로 반영한다. Reporting API에서 제공되지 않으므로 대응 코드 파일이 없다. |
| 6 | `src/extractPublishingGeSummary.ts` | Payment Summary와 Publishing 음악 상세 합계의 차이로 GE 총액 요약을 생성한다. |
| 7 | `src/validateSettlementPackage.ts` | 공식 DSR 반영 후 최종 9개 파일의 정산 합계를 다시 검증한다. |

## 2. 패키지 생성 내부 호출 순서

`src/extractMonthlyClientPackage.ts`는 아래 코드를 순서대로 호출한다.

| 호출 순서 | 코드 파일 | 함수 | 생성 또는 처리 대상 |
| ---: | --- | --- | --- |
| 1 | `src/extractCsvs.ts` | `runNeighboringExtraction()` | Neighboring 1~4 |
| 2 | `src/extractPublishingCsvs.ts` | `runPublishingExtraction()` | Publishing 1~3 및 임시 Publishing 4 |
| 3 | `src/extractPublishingShortsSummary.ts` | `runPublishingShortsSummary()` | Shorts |
| 4 | `src/validateSettlementPackage.ts` | `runSettlementValidation()` | 9개 파일 합계와 API 원천 합계 검증 |

`src/extractPublishingCsvs.ts`가 만드는 Publishing 4는 API 기반 임시 결과다. 최종 전달본에는 이 파일을 사용하지 않고 CMS의 공식 DSR 원본으로 교체해야 한다.

## 3. 정산 검증 코드

| 코드 파일 | 역할 |
| --- | --- |
| `src/validateSettlementPackage.ts` | 최종 산출물의 금액을 합산하고 API 원천 총액과 비교한다. |
| `src/extractApiSettlementSummary.ts` | 검증에 사용할 광고, 조정, Premium, Audio Tier, Shorts 원천 합계를 계산한다. `validateSettlementPackage.ts`가 자동으로 호출한다. |

## 4. 공통 코드 모듈

아래 파일은 직접 실행하지 않으며 위 실행 파일들이 자동으로 import한다.

| 코드 파일 | 역할 |
| --- | --- |
| `src/auth.ts` | Google OAuth 인증 클라이언트를 제공한다. |
| `src/configLoader.ts` | Content Owner ID와 기본 설정을 읽는다. |
| `src/assetClassifier.ts` | 정산 대상 asset 분류 모듈을 노출한다. |
| `src/reporting/constants.ts` | report type과 출력 헤더 상수를 정의한다. |
| `src/reporting/types.ts` | 추출 설정, 원천 행, 집계 결과 타입을 정의한다. |
| `src/reporting/utils.ts` | CLI 옵션, 경로, 대상 월 원천 파일 탐색을 처리한다. |
| `src/reporting/parsers.ts` | Reporting API CSV를 읽고 수익 및 사용량 데이터를 파싱한다. |
| `src/reporting/writers.ts` | Neighboring 및 Publishing CSV writer를 생성하고 종료한다. |
| `src/reporting/metadata.ts` | asset metadata를 읽고 Neighboring과 Publishing 분류에 사용한다. |

## 5. 월별 프로세스에 포함하지 않는 코드

`scratch/`, `archive/`, 분석용 스크립트, API 샘플 export 코드는 정식 월별 정산 프로세스에서 실행하지 않는다.

## 6. PowerShell 명령어 입력 순서

프로젝트 루트 `C:\Users\iweb\youtube-API-prototype`에서 실행한다.

### 6-1. 대상 월과 경로 지정

```powershell
$YearMonth = "YYYYMM"
$PackageDir = "reports_final_${YearMonth}_client_pla"
$GeDir = "reports_final_${YearMonth}_publishing_ge"
$DsrPath = "C:\path\to\DSR_FILE.TSV"
```

`$DsrPath`에는 PLA CMS에서 직접 다운로드한 대상 월의 `Usage-HardwareAudioTier-Combined-All` 원본 파일 경로를 입력한다.

### 6-2. 일별 Reporting API raw data 다운로드

```powershell
npm.cmd run get-reports -- --yearMonth=$YearMonth --reportDir=reports
```

### 6-3. 일반 Content Owner system-managed 보고서 다운로드

```powershell
npm.cmd run download-system-managed -- --yearMonth=$YearMonth --contentOwnerId=2jFu0i9K0PE3MDrkU_UUfQ --systemManagedDir=reports/system-managed
```

### 6-4. PLA Content Owner system-managed 보고서 다운로드

```powershell
npm.cmd run download-system-managed -- --yearMonth=$YearMonth --contentOwnerId=C9wllE5I6sRtJdunaUAdqQ --systemManagedDir=reports/system-managed-pla --reportTypeIds=content_owner_asset_ad_revenue_raw_a1,content_owner_asset_ad_adjustment_revenue_raw_a1,publisher_content_owner_music_asset_red_revenue_raw_a1,publisher_content_owner_asset_red_adjustment_revenue_raw_a1,content_owner_payments_summary_a1
```

### 6-5. Neighboring, Publishing, Shorts 패키지 생성

```powershell
npm.cmd run extract-client-package -- --yearMonth=$YearMonth --reportDir=reports --systemManagedDir=reports/system-managed --publishingSystemManagedDir=reports/system-managed-pla --outputDir=$PackageDir
```

이 명령이 만든 `4_publishing_ddex_dsr.csv`는 아직 최종본이 아니다.

### 6-6. 공식 Publishing 4 DSR 확인 및 반영

먼저 DSR의 `HEAD` 레코드에서 대상 월과 수신자 `kwangsoomedia-pla`가 맞는지 확인한다.

```powershell
Get-Content -LiteralPath $DsrPath -TotalCount 2
Copy-Item -LiteralPath $DsrPath -Destination "$PackageDir\4_publishing_ddex_dsr.csv" -Force
```

원본이 그대로 반영됐는지 SHA-256을 비교한다.

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath $DsrPath
Get-FileHash -Algorithm SHA256 -LiteralPath "$PackageDir\4_publishing_ddex_dsr.csv"
```

두 명령의 `Hash` 값이 같아야 한다.

### 6-7. GE 총액 요약 생성

```powershell
npm.cmd run extract-publishing-ge -- --yearMonth=$YearMonth --publishingSystemManagedDir=reports/system-managed-pla --outputDir=$GeDir
```

### 6-8. 공식 DSR 반영 후 최종 정산 검증

```powershell
npm.cmd run validate-settlement-package -- --yearMonth=$YearMonth --systemManagedDir=reports/system-managed --publishingSystemManagedDir=reports/system-managed-pla --outputDir=$PackageDir
```

### 6-9. 최종 전달 파일 확인

```powershell
Get-ChildItem -Path $PackageDir -File | Select-Object Name,Length
Get-ChildItem -Path $GeDir -File | Select-Object Name,Length
```

`$PackageDir`에는 정산 파일 9개가 있어야 하며 `$GeDir`에는 `publishing_ge_summary.csv`가 있어야 한다.
