# 월별 정산 작업 메모

## 확정 결정

- 최종 패키지는 Neighboring 1~4, Publishing 1~3, Shorts로 구성된 8개 파일이다.
- Publishing 4 DDEX DSR은 생성, 검증, 전달 대상에서 제외한다.
- 사용자는 대상 월만 입력하고 전체 프로세스를 순차 실행할 수 있어야 한다.
- GE는 상세 파일이 아니라 Payment Summary와 Publishing 음악 상세의 차액 총액만 생성한다.

## 구현 결과

- `src/runMonthlySettlement.ts`와 `run-monthly-settlement.cmd`가 월 입력형 실행을 제공한다.
- 새 실행기의 패키지 경로는 기존 산출물을 건드리지 않는 `reports_final_YYYYMM_client_pla_8files`다.
- `src/extractPublishingCsvs.ts`와 `src/reporting/writers.ts`에서 Publishing 4 생성 경로를 제거했다.
- `src/validateSettlementPackage.ts`와 `src/validateClientPackage.ts`에서 Publishing 4 검증을 제거했다.
- system-managed 다운로드는 일반 Content Owner와 PLA Content Owner에 대해 각각 실행해야 한다.

## 검증 및 작업 중 사고 기록

- `npm.cmd run monthly-settlement -- --yearMonth=202613`은 잘못된 월을 종료 코드 1로 거부했다.
- Publishing writer 단위 검사에서 Publishing 1~3만 생성되고 Publishing 4는 생성되지 않았다.
- 전체 TypeScript 검사는 기존 분석·샘플 코드 오류 때문에 실패했으며 이번 변경 파일의 신규 오류는 남아 있지 않다.
- 검증 중 실수로 `202606` 전체 실행을 시작했다가 중단했다. 기존 `reports_final_202606_client_pla`의 Publishing 4는 원본 DSR로 복원했지만 Neighboring 1, 3, 4는 중간 출력 상태라 별도 복구가 필요하다.

## 202606 승인본 회귀검증

- 승인 기준본은 `realFinal/reports_final_202606_client_pla`와 `realFinal/reports_final_202606_publishing_ge`다.
- 새 결과는 `reports_regression_202606_client_pla_8files`와 `reports_regression_202606_publishing_ge`에 생성했다.
- Publishing 4를 제외한 8개 정산 파일은 승인본과 파일 크기 및 SHA-256이 전부 일치했다.
- GE 요약도 승인본과 SHA-256이 일치했다.
- 새 패키지에는 파일이 정확히 8개이며 `4_publishing_ddex_dsr.csv`는 존재하지 않는다.
- `validate-settlement-package` 결과는 `mainPackageTotal=112812.864160486`, `apiTotal=112812.864160486`, `difference=0.000000000`이다.

## 정산 추출 성능 개선 결정

- 성능 개선 계획은 `PERFORMANCE_OPTIMIZATION_PLAN.md`에 기록한다.
- 첫 변경 범위는 Publishing 사용량 CSV의 반복적인 컬럼명 탐색 제거로 제한한다.
- 금액 계산식, 필터, 집계 순서, 파일 작성 형식은 변경하지 않는다.
- 일별 파일 제외, Asset ID 필터링, 병렬 처리와 월별 캐시는 1차 범위에서 제외한다.
- 6월 기준 8개 파일과 GE 요약의 SHA-256이 모두 일치하고 실행 시간이 단축될 때만 변경을 채택한다.
- 하루치 사용량 파일만으로 승인본과 일치했던 실험은 나머지 일별 파일을 제외하는 근거로 사용하지 않는다.

## 202606 1차 성능 최적화 검증 결과

- 기준 실행은 `reports_perf_baseline_202606_client_pla_8files`와 `reports_perf_baseline_202606_publishing_ge`에 생성했으며 승인 기준 8개 파일 및 GE 요약과 SHA-256이 모두 일치했다.
- 1차 최적화 결과는 `reports_perf_optimized_202606_client_pla_8files`와 `reports_perf_optimized_202606_publishing_ge`에 생성했다.
- `src/reporting/parsers.ts`의 `buildPublishingUsageCacheFromReports()`에서 파일별 헤더를 한 번 해석하고 필수 컬럼 인덱스로 각 행을 읽도록 변경했다.
- 금액 계산식, 필터, 집계 키와 누적 순서, CSV writer 및 출력 형식은 변경하지 않았다.
- 최적화 결과 8개 파일과 GE 요약은 승인 기준과 SHA-256, 파일 크기, 헤더 및 행 수가 모두 일치했다.
- 패키지 파일은 정확히 8개이고 `4_publishing_ddex_dsr.csv`는 생성되지 않았다.
- 전체 패키지 실행 시간은 1410.303초에서 572.427초로 837.876초 단축됐다.
- Publishing 단계는 생성 파일 시각 기준 1162.486초에서 348.544초로 813.942초 단축됐다.
- 독립 `validate-settlement-package` 결과는 `mainPackageTotal=112812.864160486`, `apiTotal=112812.864160486`, `difference=0.000000000`이다.
- 대상 파일 단독 TypeScript 검사는 통과했다. 전체 TypeScript 검사는 기존 분석·샘플 코드 오류로 실패했으며 `src/reporting/parsers.ts` 오류는 없었다.

## 월별 정산 명령 순서

- 통합 CMD 실행기를 사용하지 않는 단계별 수동 명령은 `MONTHLY_SETTLEMENT_COMMAND_SEQUENCE.md`에 기록한다.
- 현재 코드의 실제 추출 순서는 Neighboring 1~4, Publishing 1~3, Shorts, 정산 검증 순서다.
- 해당 문서에서는 `run-monthly-settlement.cmd`와 `monthly-settlement` 통합 실행 명령을 사용하지 않는다.

## 202606 Publishing 3 메타데이터 수정

- PLA `publisher_content_owner_music_asset_red_revenue_raw_a1` 원천에는 `asset_title`과 `custom_id`가 존재하지만 `writeMonthlySummary()`가 원천 값을 무시하고 메타데이터 캐시만 사용하고 있었다.
- 기존 `3_publishing_monthly_sub.csv` 10,364행은 제목이 모두 `Untitled Asset`이고 Custom ID가 모두 공란이었다.
- `src/extractPublishingCsvs.ts`에서 `summary.sourceTitle`과 `summary.sourceCustomId`를 우선하고 없을 때만 기존 메타데이터 fallback을 사용하도록 수정했다.
- 검증 결과 제목과 Custom ID를 제외한 셀 차이는 0개이며 Partner Revenue 합계는 변경 전후 `2011.08566266159`로 동일하다.
- 수정 결과의 제목 fallback은 6행, Custom ID 공란은 37행이다. 이는 원천에도 값이 없고 메타데이터 캐시 fallback도 없는 행이다.
- Publishing 1과 2의 SHA-256은 승인 기준과 동일하다.
- 수정된 8개 패키지는 `reports_metadata_fix_202606_client_pla_8files`에 구성했으며 정산 검증 결과 `difference=0.000000000`이다.

## 202606 Shorts 곡별 정산 가능 범위 조사

- 일반 Content Owner에는 `music_content_owner_shorts_revenue_summary_a1` 작업만 있고, PLA Content Owner에는 Shorts 시스템 관리 작업이 없다.
- 공식 `music_content_owner_shorts_revenue_summary_a1`은 국가별 총액이고, `publisher_content_owner_shorts_revenue_summary_a1`도 자산 ID나 곡별 수익 필드를 제공하지 않는다.
- 현재 인증 상태에서 PLA의 `publisher_content_owner_shorts_revenue_summary_a1` 작업은 제공되지 않는다.
- `content_owner_asset_combined_a3`의 `playback_location_type=10`을 기준으로 202606 Shorts 사용량을 추출했다. 결과는 27,018행, 고유 자산 4,728개, 조회수 39,629,763회다.
- 곡별 사용량에는 조회수, 참여 조회수, 시청 시간, Premium 조회수와 영상 수가 있으나 수익 컬럼은 없다.
- 일반 Content Owner의 2026-06-30 `content_owner_asset_a3` 스냅샷은 74,232행이며 Shorts 자산 4,728개 중 4,724개를 매칭했다.
- 매칭된 4,724개 모두에서 `asset_title`과 `custom_id`를 확보할 수 있고 3,014개에는 ISRC도 존재한다.
- 곡별 Shorts 사용량 상세는 거의 전부 곡명과 Custom ID로 보강할 수 있지만, 국가별 Shorts 총액을 조회수 비율로 배분한 값은 YouTube 실제 정산금이 아니다.
- 클라이언트 지급용 곡별 실제 Shorts 수익을 만들려면 YouTube가 자산별 수익 보고서 또는 공식 배분 기준을 별도로 제공해야 한다.

## 202606 Shorts 참고자료 생성

- 재사용 가능한 보강 도구 `src/enrichShortsSongData.ts`와 `npm run enrich-shorts-song-data` 명령을 추가했다.
- 전달 폴더는 `reports_final_202606_shorts_reference`이며 국가별 수익 총액과 곡별 사용량 상세 2개 파일로 구성했다.
- 곡별 상세는 27,018행이며 보강 전후 사용량 관련 셀 차이는 0개이고 Shorts 조회수 합계는 모두 39,629,763회다.
- 자산 4,728개 중 4,724개를 2026-06-30 자산 스냅샷과 연결했다. 제목 누락 26,961행, Custom ID 누락 6,385행, ISRC 누락 21,047행을 보강했다.
- 미해결 4개 자산의 57행은 Partner API에서 `Auto generated asset`으로 확인됐고 광수코드가 없어 공란을 유지했다. 해당 조회수는 1,067회다.
- 곡별 상세에는 수익 컬럼이 없으며, 국가별 총액 파일의 수익 합계는 `718.6496335355961` USD다.
- 국가별 총액 파일은 기존 승인 패키지의 `5_publishing_shorts_revenue_summary.csv`와 SHA-256이 동일한 사본이다.

## 202606 Shorts Video ID 상세 재추출

- `src/extractShortsSongData.ts`가 기존 곡·국가 집계와 함께 Asset ID·국가·Video ID 단위 상세파일도 생성하도록 확장했다.
- 기존 `shorts_song_data_202606.csv`는 변경 전후 SHA-256이 `EF917FA4F97460F27337AC81A803EA83E37AE703C36014622C506714FD251421`로 동일하다.
- Video ID 상세는 `reports_final_202606_shorts_reference/202606_shorts_video_usage_detail_reference.csv`이며 103,096행이다.
- 고유 Video ID는 29,876개이고 Video ID 공란은 0건이다. 하나의 영상이 여러 Asset ID와 연결된 Video ID는 96개다.
- 영상 상세의 Shorts Views 합계는 39,629,763회, Engaged Views 합계는 19,044,460회이며 곡별 상세 합계와 정확히 일치한다.
- 모든 곡·국가 그룹에 영상 상세가 존재하고 Distinct Video Count 차이는 0개다.
- 시청 시간은 행별 소수점 6자리 출력 후 재합산한 반올림 차이만 있으며 최대 차이는 0.000017분이다.
- Publishing 자산 1건은 Partner API에서도 제목이 `Unknown`으로 제공돼 임의 곡명을 넣지 않고 `Untitled Asset`을 유지했다. Custom ID와 ISRC는 존재한다.

## Google Cloud 프로젝트 복원 확인

- OAuth 프로젝트 `firebase-iweb`의 프로젝트 번호는 `218859518321`이다.
- 프로젝트 복원 후 YouTube Partner API 자산 조회가 성공했다.
- 프로젝트 복원 후 YouTube Reporting API의 Content Owner 작업 목록 조회도 성공했다.

## 월별 Shorts Video Usage 자동 포함

- `src/downloadSystemManagedReports.ts`에 `--latestOnly` 옵션을 추가했다. 202606 검증에서 월간 자산 보고서 27개 중 2026-06-30 스냅샷 한 개만 선택했다.
- `src/runMonthlySettlement.ts`는 일반·PLA 보고서 외에 일반 Content Owner의 `content_owner_asset_a3` 월말 스냅샷을 자동 다운로드한다.
- 월별 실행기는 `src/extractShortsSongData.ts`로 Video Usage를 생성하고 `src/enrichShortsSongData.ts`로 메타데이터를 보강한다.
- 최종 패키지 경로는 `reports_final_YYYYMM_client_pla_9files`이며 `6_shorts_video_usage_detail.csv`를 포함한다.
- Video Usage는 검증 참고파일이므로 기존 8개 정산 파일 합계에는 포함하지 않는다.
- 202606 전체 단일 실행 시간은 1,146.8초이며 정산 검증 결과는 `difference=0.000000000`이다.
- 새 패키지의 기존 8개 정산 파일은 `reports_metadata_fix_202606_client_pla_8files`와 SHA-256이 모두 일치한다.
- 자동 생성 Video Usage의 SHA-256은 `DB82BB10DB1698A32286EBFACD4CCA1C28516C917ACAB2CA41A0914FCFF21B1F`이며 수동 검증본과 일치한다.
