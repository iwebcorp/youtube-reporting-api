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
