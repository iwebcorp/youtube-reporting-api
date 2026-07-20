# 월별 정산 단일 실행 프로세스

## 실행 방법

Windows 탐색기에서 아래 파일을 더블클릭한다.

```text
run-monthly-settlement.cmd
```

화면에 정산 대상 월을 `YYYYMM` 형식으로 입력하고 Enter를 누른다.

```text
정산 대상 월을 YYYYMM 형식으로 입력하세요. 202607
```

터미널에서는 아래 명령 하나만 실행해도 같은 방식으로 월을 입력할 수 있다.

```powershell
npm.cmd run monthly-settlement
```

월을 명령에 바로 지정하려면 아래처럼 실행한다.

```powershell
npm.cmd run monthly-settlement -- --yearMonth=202607
```

## 자동 실행 순서

월을 입력하면 `src/runMonthlySettlement.ts`가 아래 작업을 순서대로 실행한다.

1. `src/getReports.ts`로 일별 Reporting API raw data를 다운로드한다.
2. `src/downloadSystemManagedReports.ts`로 일반 Content Owner system-managed 보고서를 다운로드한다.
3. 같은 코드로 PLA Content Owner system-managed 및 Payment Summary를 다운로드한다.
4. `src/extractMonthlyClientPackage.ts`로 정산 파일 8개를 생성하고 합계를 검증한다.
5. `src/extractPublishingGeSummary.ts`로 GE 총액 요약을 생성한다.

앞 단계가 실패하면 다음 단계는 실행하지 않는다. 이미 다운로드된 같은 파일은 기존 downloader 로직에 따라 건너뛴다.

## 최종 산출물

`reports_final_YYYYMM_client_pla_8files/`에 아래 8개 파일이 생성된다.

1. `1_neighboring_daily_ad.csv`
2. `1_publishing_daily_ad.csv`
3. `2_neighboring_daily_ad_adj.csv`
4. `2_publishing_daily_ad_adj.csv`
5. `3_neighboring_monthly_sub.csv`
6. `3_publishing_monthly_sub.csv`
7. `4_neighboring_financial_detail.csv`
8. `5_publishing_shorts_revenue_summary.csv`

`reports_final_YYYYMM_publishing_ge/`에는 아래 파일이 생성된다.

1. `publishing_ge_summary.csv`

## Publishing 4 제외 기준

`4_publishing_ddex_dsr.csv`는 생성, 검증, 전달 대상에서 제외한다.

YouTube가 `Hardware Audio Tier DSR 상세 보고서`를 Reporting API로 제공하지 않는다고 공식 회신했기 때문이다. API 원천만으로 공식 DSR과 같은 상세 파일을 재구성하지 않는다.

`4_neighboring_financial_detail.csv`는 Reporting API가 제공하는 별도 원천으로 생성되므로 계속 포함한다.

## 필수 코드 파일

| 코드 파일 | 역할 |
| --- | --- |
| `src/runMonthlySettlement.ts` | 전체 단계를 순차 실행하고 최종 파일을 확인한다. |
| `src/getReports.ts` | 일별 raw data를 다운로드한다. |
| `src/downloadSystemManagedReports.ts` | 일반 및 PLA system-managed 보고서를 다운로드한다. |
| `src/extractMonthlyClientPackage.ts` | 8개 정산 파일 생성 순서를 관리한다. |
| `src/extractCsvs.ts` | Neighboring 1~4를 생성한다. |
| `src/extractPublishingCsvs.ts` | Publishing 1~3을 생성한다. |
| `src/extractPublishingShortsSummary.ts` | Shorts 요약을 생성한다. |
| `src/extractPublishingGeSummary.ts` | GE 총액 요약을 생성한다. |
| `src/validateSettlementPackage.ts` | 8개 정산 파일의 합계를 검증한다. |
| `src/extractApiSettlementSummary.ts` | 검증용 API 원천 합계를 계산한다. |

인증, 설정, CSV parsing, metadata 및 writer 코드는 위 실행 파일에서 자동으로 import되므로 별도로 실행하지 않는다.
