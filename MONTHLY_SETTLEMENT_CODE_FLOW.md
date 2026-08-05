# 월별 정산 단일 실행 프로세스

## 실행 방법

일반 사용자는 `start-gui.cmd`를 더블클릭해 월과 실행 단계를 선택한다. 자세한 사용법은 `GUI_RUNBOOK.md`에 기록한다.

기존 전체 실행 CMD도 유지한다.

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
4. 일반 Content Owner의 월말 자산 메타데이터 스냅샷 한 개를 다운로드한다.
5. `src/extractMonthlyClientPackage.ts`로 정산 파일 8개를 생성하고 합계를 검증한다.
6. `src/extractShortsSongData.ts`로 Shorts Video Usage를 생성한다.
7. `src/enrichShortsSongData.ts`로 곡명, Custom ID와 ISRC를 보강한다.
8. `src/extractPublishingGeSummary.ts`로 GE 총액 요약을 생성한다.

앞 단계가 실패하면 다음 단계는 실행하지 않는다. 이미 다운로드된 같은 파일은 기존 downloader 로직에 따라 건너뛴다.

## 최종 산출물

`reports_final_YYYYMM_client_pla_9files/`에 아래 9개 파일이 생성된다.

1. `1_neighboring_daily_ad.csv`
2. `1_publishing_daily_ad.csv`
3. `2_neighboring_daily_ad_adj.csv`
4. `2_publishing_daily_ad_adj.csv`
5. `3_neighboring_monthly_sub.csv`
6. `3_publishing_monthly_sub.csv`
7. `4_neighboring_financial_detail.csv`
8. `5_publishing_shorts_revenue_summary.csv`
9. `6_shorts_video_usage_detail.csv`

`6_shorts_video_usage_detail.csv`는 Video ID와 Engaged Views를 확인하기 위한 참고파일이며 정산 합계에는 더하지 않는다.

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
| `src/downloadSystemManagedReports.ts` | 일반·PLA 보고서와 월말 자산 메타데이터 스냅샷을 다운로드한다. |
| `src/extractMonthlyClientPackage.ts` | 8개 정산 파일 생성 순서를 관리한다. |
| `src/extractCsvs.ts` | Neighboring 1~4를 생성한다. |
| `src/extractPublishingCsvs.ts` | Publishing 1~3을 생성한다. |
| `src/extractPublishingShortsSummary.ts` | Shorts 요약을 생성한다. |
| `src/extractShortsSongData.ts` | Shorts 곡별 및 Video ID별 사용량을 생성한다. |
| `src/enrichShortsSongData.ts` | Shorts 상세에 자산 메타데이터를 보강한다. |
| `src/extractPublishingGeSummary.ts` | GE 총액 요약을 생성한다. |
| `src/validateSettlementPackage.ts` | 8개 정산 파일의 합계를 검증한다. |
| `src/extractApiSettlementSummary.ts` | 검증용 API 원천 합계를 계산한다. |

인증, 설정, CSV parsing, metadata 및 writer 코드는 위 실행 파일에서 자동으로 import되므로 별도로 실행하지 않는다.

## GUI 관련 코드

| 파일 | 역할 |
| --- | --- |
| `start-gui.cmd` | Node 실행 경로를 선택하고 로컬 GUI 서버를 시작한다. |
| `src/guiServer.ts` | 로컬 HTTP API, 실행 프로세스, 중지와 실시간 로그를 관리한다. |
| `src/monthlyReadiness.ts` | 월별 Raw, System-managed, 최종 산출물의 실제 파일 상태를 검사한다. |
| `ui/index.html` | 월 선택과 단계 선택 화면을 제공한다. |
| `ui/app.js` | 선행 단계 자동 선택, 상태 조회와 실시간 로그를 처리한다. |
| `ui/style.css` | 데스크톱과 모바일 작업 화면을 구성한다. |

GUI는 외부 네트워크에 공개하지 않고 `127.0.0.1:43127`에서만 실행된다. 동시에 한 개의 월별 작업만 실행할 수 있다.
