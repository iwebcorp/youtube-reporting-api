# 월별 정산 작업 메모

## 확정 결정

- 최종 패키지는 Neighboring 1~4, Publishing 1~3, Shorts로 구성된 8개 파일이다.
- Publishing 4 DDEX DSR은 생성, 검증, 전달 대상에서 제외한다.
- 사용자는 대상 월만 입력하고 전체 프로세스를 순차 실행할 수 있어야 한다.
- GE는 상세 파일이 아니라 Payment Summary와 Publishing 음악 상세의 차액 총액만 생성한다.

## 현재 구현 제약

- `src/extractMonthlyClientPackage.ts`는 현재 Publishing 4를 생성하는 `runPublishingExtraction()`과 9개 기준 검증을 호출한다.
- `src/extractPublishingCsvs.ts`와 `src/reporting/writers.ts`에 Publishing 4 생성 경로가 남아 있다.
- `src/validateSettlementPackage.ts`와 `src/validateClientPackage.ts`가 Publishing 4를 파일 목록에 포함한다.
- system-managed 다운로드는 일반 Content Owner와 PLA Content Owner에 대해 각각 실행해야 한다.
