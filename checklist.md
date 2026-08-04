# 월별 정산 단일 실행기 체크리스트

- [x] Publishing 4 생성 및 검증 경로 확인.
- [x] Publishing 4를 패키지 생성과 검증에서 제거.
- [x] 월 입력형 단일 실행기와 npm 명령 추가.
- [x] 기존 GE 계산 로직을 변경하지 않음.
- [x] 실행 문서를 단일 명령 기준으로 갱신.
- [x] 월 입력 검증과 Publishing writer 파일 목록 확인.
- [ ] 전체 타입 검사 통과. 기존 프로젝트 오류로 실패함.

## 정산 추출 성능 개선 계획

- [x] 현재 단계별 실행 시간과 Publishing 병목 확인.
- [x] 결과 보존 우선의 단계별 최적화 계획서 작성.
- [x] 6월 기준 산출물의 SHA-256과 실행 시간 기록.
- [x] Publishing CSV 헤더 해석 최적화만 적용.
- [x] 별도 출력 폴더에 6월 전체 패키지 재생성.
- [x] 8개 파일과 GE 요약의 SHA-256 및 정산 합계 비교.
- [x] 결과 동일성과 시간 단축이 모두 확인된 경우에만 최적화 채택.

## 월별 정산 명령 문서

- [x] raw data부터 GE summary까지 실제 코드 기준 실행 순서 확인.
- [x] 통합 CMD 실행기를 사용하지 않는 단계별 수동 명령 문서화.
- [x] 2026년 6월 실제 파일 기준 단계별 예상 용량 문서화.

## Publishing 3 메타데이터 보완

- [x] `3_publishing_monthly_sub.csv`의 Asset Title 및 Custom ID 누락 원인 확인.
- [x] PLA 원천의 Asset Title과 Custom ID를 우선 사용하도록 writer 수정.
- [x] 별도 폴더에 202606 Publishing 1~3 재추출.
- [x] 제목과 Custom ID 외 모든 셀 및 Partner Revenue 합계 동일성 확인.
- [x] 8개 파일 정산 검증 `difference=0.000000000` 통과.

## Shorts 곡별 정산 가능 범위 조사

- [x] 공식 Shorts 재무 보고서의 제공 필드 확인.
- [x] 일반 및 PLA Content Owner의 실제 시스템 관리 작업 목록 확인.
- [x] 202606 곡별 Shorts 사용량 추출 및 자산 수 집계.
- [x] 자산 메타데이터 스냅샷으로 곡명과 Custom ID 매칭률 확인.
- [x] 곡별 실제 Shorts 수익은 현재 제공 데이터만으로 산출할 수 없음을 확인.
- [x] 202606 곡별 Shorts 사용량에 자산 제목, Custom ID, ISRC 보강.
- [x] 국가별 Shorts 총액과 곡별 사용량 참고자료를 별도 전달 폴더로 구성.
- [x] 보강 전후 행 수와 모든 사용량 셀의 동일성 검증.
- [x] 202606 Shorts Video ID 상세 103,096행 재추출.
- [x] 영상별 합계를 곡별로 재집계해 Views와 Engaged Views 동일성 검증.
- [x] 복원된 `firebase-iweb` 프로젝트의 Partner API와 Reporting API 접근 확인.

## 월별 Shorts Video Usage 자동 포함

- [x] system-managed downloader에 월말 스냅샷 한 개만 받는 `--latestOnly` 옵션 추가.
- [x] 월별 실행기에 자산 메타데이터 다운로드, Video Usage 생성 및 보강 단계 연결.
- [x] 최종 패키지를 8개 정산 파일과 Video Usage 참고파일을 포함한 9개 구성으로 변경.
- [x] 202606 단일 실행기 전체 회귀검증 통과.
- [x] 기존 8개 정산 파일과 승인 기준본의 SHA-256 동일성 확인.
- [x] 자동 생성 Video Usage와 수동 검증본의 SHA-256 동일성 확인.
