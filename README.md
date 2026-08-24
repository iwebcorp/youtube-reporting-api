# 광수미디어 YouTube 월별 정산 추출기

YouTube Reporting API와 Content Manager 권한을 사용해 월별 원천 데이터를 내려받고, 광수미디어 전달용 정산 파일을 생성하는 Windows용 로컬 프로그램입니다.

## 준비 사항

- Windows 10 또는 11.
- [Node.js LTS](https://nodejs.org/)와 Git.
- 아이웹에서 별도로 전달한 `credentials.json`.
- 광수미디어 YouTube Content Manager에 접근 가능한 Google 계정.

인증 파일, 로그인 토큰, 원천 데이터, 정산 결과물은 보안상 Git에 올라가지 않습니다.

## 최초 설치

1. 아이웹에서 안내한 비공개 Git 저장소를 내려받습니다.
2. 아이웹에서 안전한 경로로 전달받은 인증 파일을 프로젝트 최상위 폴더에 `credentials.json` 이름으로 둡니다.
3. `setup-client.cmd`를 더블 클릭합니다.
4. 브라우저가 열리면 Content Manager 권한이 있는 Google 계정으로 로그인하고 접근을 허용합니다.
5. 월별 정산 화면이 열리면 설치가 끝난 것입니다.

인증은 PC별 최초 1회가 원칙입니다. `token.json`이 생성된 뒤에는 토큰이 유효한 동안 다시 로그인하지 않습니다.

## 매월 실행

1. `update-and-start.cmd`를 더블 클릭합니다.
2. 정산 대상 월만 선택합니다.
3. `일별 Raw Data`, `System-managed Data`, `정산 파일 추출` 순서로 실행합니다.
4. 앞 단계가 준비되지 않으면 정산 파일 추출은 실행되지 않습니다.
5. 각 단계가 완료될 때까지 창을 닫거나 PC를 절전 상태로 전환하지 않습니다.

소스 업데이트가 필요 없는 경우에는 `start-gui.cmd`로 바로 실행할 수 있습니다. 브라우저가 자동으로 열리지 않으면 터미널에 표시된 로컬 주소를 Chrome 또는 Edge에서 엽니다.

`System-managed Data` 단계는 정산 보고서와 General·PLA 자산 메타데이터를 모두 Reporting API로 내려받습니다. 준비 완료 판정에 필요한 파일은 총 11종입니다. 조정 보고서처럼 발생 내역이 있을 때만 발행되는 선택 보고서는 월별로 추가 다운로드 수가 달라질 수 있습니다.

정산 파일은 이 단계에서 다운로드한 해당 월 API 원본만 사용합니다. 과거 월 캐시, CMS에서 수동으로 받은 파일, 기존 산출물을 대체 자료로 사용하지 않으며 원본에 없는 메타데이터 값은 공란으로 둡니다.

## 생성 결과

정산 대상이 `202607`이면 전달용 폴더는 `reports_final_202607_client_pla_10files`로 생성됩니다.

1. `1_neighboring_daily_ad.csv`.
2. `2_neighboring_daily_ad_adj.csv`.
3. `3_neighboring_monthly_sub.csv`.
4. `4_neighboring_financial_detail.csv`.
5. `5_neighboring_payment_summary.csv`.
6. `1_publishing_daily_ad.csv`.
7. `2_publishing_daily_ad_adj.csv`.
8. `3_publishing_monthly_sub.csv`.
9. `5_publishing_shorts_revenue_summary.csv`.
10. `6_shorts_video_usage_detail.csv`.

GE 총액 요약은 `reports_final_202607_publishing_ge` 폴더에 별도로 생성됩니다.

최종 산출물은 전달용 정산 파일 10개와 GE 총액 요약 1개를 합쳐 총 11개입니다.

`Publishing 4`는 YouTube가 Hardware Audio Tier DSR 상세 보고서를 Reporting API로 제공하지 않아 생성 대상에서 제외되어 있습니다. Shorts 상세 파일은 `Engaged Views`와 Video ID를 포함한 사용 내역이며, 곡별 확정 수익 보고서 자체는 아닙니다.

## 데이터 보관

- `reports` 폴더에는 API에서 내려받은 원천 데이터가 저장됩니다.
- `reports_final_YYYYMM_client_pla_10files` 폴더에는 광수미디어 전달용 10개 파일이 저장됩니다.
- `reports_final_YYYYMM_publishing_ge` 폴더에는 GE 총액 요약이 저장됩니다.
- 다음 달 추출이 끝났다고 이전 달 원천 데이터와 산출물을 바로 삭제하지 마십시오.

## 오류가 발생한 경우

- `System-managed data incomplete`가 표시되면 YouTube가 해당 월 보고서를 아직 발행하지 않은 상태일 수 있습니다. 다음 영업일에 다시 확인합니다.
- `access_denied`, `deleted_client`, Content Owner 접근 오류가 표시되면 임의로 인증 파일이나 토큰을 바꾸지 말고 아이웹에 문의합니다.
- 문의할 때는 선택한 월, 실패한 단계, 화면의 전체 오류 메시지를 함께 전달합니다.

## 보안 주의사항

- `credentials.json`, `token.json`, CSV·TSV·XLSX 파일을 Git에 커밋하지 않습니다.
- 프로젝트 폴더나 인증 파일을 이메일 또는 공개 링크로 공유하지 않습니다.
- 담당자나 PC가 변경되면 아이웹에 알려 기존 토큰 폐기와 재인증을 진행합니다.

## 아이웹 관리 항목

광수미디어 인계 전 Google OAuth 앱을 테스트 상태가 아닌 프로덕션으로 게시하고, 게시 후 새 토큰을 발급해 장기 갱신 여부를 확인해야 합니다. Content Owner 권한과 Reporting API 작업 목록은 OAuth 프로젝트와 별개로 YouTube 측에 유지되지만, 인증 파일과 토큰은 새 OAuth 클라이언트 기준으로 관리합니다.
