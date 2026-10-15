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
4. 4단계 `Custom ID 입력`에 공란이 표시되면 버튼을 눌러 Asset ID별로 Custom ID를 입력하고 저장합니다.
5. 5단계 `정산금 계산`에 환율(원/USD)을 입력하고 실행합니다. Custom ID 공란이 남아 있으면 실행되지 않습니다.
6. 앞 단계가 준비되지 않으면 정산 파일 추출과 정산금 계산은 실행되지 않습니다.
7. 각 단계가 완료될 때까지 창을 닫거나 PC를 절전 상태로 전환하지 않습니다.

소스 업데이트가 필요 없는 경우에는 `start-gui.cmd`로 바로 실행할 수 있습니다. 브라우저가 자동으로 열리지 않으면 터미널에 표시된 로컬 주소를 Chrome 또는 Edge에서 엽니다.

`System-managed Data` 단계는 정산 보고서와 General·PLA 자산 메타데이터를 모두 Reporting API로 내려받습니다. 이어서 정산 원본과 자산 메타데이터에 Custom ID가 없는 자산만 Content ID API로 조회해 `reports/system-managed-assets*/YYYYMM_content_id_custom_ids.csv`에 저장합니다. 준비 완료 판정에 필요한 파일은 Reporting API 11종과 Content ID 조회 결과 2종을 합쳐 총 13종입니다. 조정 보고서처럼 발생 내역이 있을 때만 발행되는 선택 보고서는 월별로 추가 다운로드 수가 달라질 수 있습니다.

정산 파일은 이 단계에서 받은 해당 월 API 원본만 사용합니다. 과거 월 캐시, CMS에서 수동으로 받은 파일, 기존 산출물을 대체 자료로 사용하지 않습니다.

Custom ID는 정산 원본, 월말 자산 메타데이터, Content ID API 조회 결과 순서로 채웁니다. 그래도 Custom ID가 빈 행은 YouTube CMS에 값이 등록되지 않아 API로 받을 수 없는 경우입니다. 추출은 그대로 완료하고, `reports_custom_id_YYYYMM/custom_id_input_required_YYYYMM.csv`에 파일명, 행 번호, 열 위치, Asset ID를 `공란` 유형으로 남깁니다. 4단계 `Custom ID 입력` 창에 공란 자산이 Asset ID별로 표시되며, 입력한 값은 전달용 정산 파일 10개의 해당 공란에 바로 저장되고 목록에서 빠집니다. 비워 둔 자산은 다음에 다시 입력할 수 있습니다.

저작권 곡 중 CMS에 Custom ID가 여러 개 등록된 곡은 메타데이터로 값을 추정하지 않습니다. 정산 보고서나 Content ID API가 준 값을 그대로 쓰고, 같은 목록에 `참고` 유형으로 현재 값과 CMS 등록 값을 함께 남깁니다. `참고` 행은 입력할 필요가 없으며 CMS 정리 여부를 확인하는 용도입니다. CMS에 Custom ID를 등록한 뒤 `System-managed Data`와 `정산 파일 추출`을 다시 실행해도 됩니다.

## 생성 결과

정산 대상이 `202607`이면 전달용 폴더는 `reports_final_202607_client_pla_10files`로 생성됩니다. 금액이 정확히 0인 행은 삭제합니다(1~4번 인접·1~3번 저작은 Partner Revenue, 5번 Shorts 요약은 Shorts Flat Fee Revenue USD, 6번 Shorts 상세는 Engaged Views 기준). 0.0001처럼 작은 값은 남기며, 5번 인접 지급 요약은 대상이 아닙니다.

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

## 정산금 계산

정산금은 4단계에서 Custom ID 공란을 모두 채운 뒤 5단계에서 입력한 환율로 계산합니다.

결과는 `reports_settlement_YYYYMM` 폴더에 원본 행마다 계산 열을 붙인 CSV로 생성됩니다. 원천세 공제 후 금액과 최종 금액은 USD와 원(USD × 환율)을 함께 표시합니다. 금액은 반올림하지 않습니다.

- `인접` 폴더: 1~4번 파일은 Country가 US인 행만 Partner Revenue에서 원천세 10%를 뺍니다. 1·3번은 Asset Type이 Art Track·Sound Recording인 행에서 실연권료 11.47%를 추가로 뺍니다. Shorts는 5번 파일의 원천세 공제 후 수익(US만 10% 공제) 합계를, 5번 파일에 있는 국가의 6번 파일 행 전체 Engaged Views 점유율대로 나눕니다. 점유율은 국가별이 아니라 대상 행 전체 합계 기준입니다.
- `저작` 폴더: 1~3번 파일의 Partner Revenue에 환율을 곱합니다.
- `실연권료` 폴더: 1·3번 파일의 Art Track·Sound Recording 행만 모아 원천세 공제 후 금액의 11.47%를 계산합니다.
- `정산금_요약_YYYYMM.csv`: 파일별 행 수와 원본·원천세 공제 후·결과 합계를 USD와 원으로 모두 표시합니다.

저작 오디오서비스는 `Publishing 4`와 같은 이유로 API로 제공되지 않아 계산 대상에서 제외합니다.

## 데이터 보관

- `reports` 폴더에는 API에서 내려받은 원천 데이터가 저장됩니다.
- `reports_final_YYYYMM_client_pla_10files` 폴더에는 광수미디어 전달용 10개 파일이 저장됩니다.
- `reports_final_YYYYMM_publishing_ge` 폴더에는 GE 총액 요약이 저장됩니다.
- `reports_settlement_YYYYMM` 폴더에는 정산금 계산 결과가 저장됩니다.
- 다음 달 추출이 끝났다고 이전 달 원천 데이터와 산출물을 바로 삭제하지 마십시오.

## 오류가 발생한 경우

- `System-managed data incomplete`가 표시되면 YouTube가 해당 월 보고서를 아직 발행하지 않은 상태일 수 있습니다. 다음 영업일에 다시 확인합니다.
- `Custom ID 공란` 경고가 표시되면 `Custom ID 확인 목록 열기`로 목록을 열어 `공란` 유형의 파일·행·열에 Custom ID를 직접 입력합니다.
- `Content ID API 접근이 거부되었습니다`가 표시되면 아이웹에 문의합니다.
- `access_denied`, `deleted_client`, Content Owner 접근 오류가 표시되면 임의로 인증 파일이나 토큰을 바꾸지 말고 아이웹에 문의합니다.
- 문의할 때는 선택한 월, 실패한 단계, 화면의 전체 오류 메시지를 함께 전달합니다.

## 보안 주의사항

- `credentials.json`, `token.json`, CSV·TSV·XLSX 파일을 Git에 커밋하지 않습니다.
- 프로젝트 폴더나 인증 파일을 이메일 또는 공개 링크로 공유하지 않습니다.
- 담당자나 PC가 변경되면 아이웹에 알려 기존 토큰 폐기와 재인증을 진행합니다.

## 아이웹 관리 항목

OAuth 인증 범위에 Reporting API 외에 Content ID API(`youtubepartner`)가 포함됩니다. 기존 토큰에 이 권한이 없으면 다음 실행 때 브라우저 로그인이 다시 열리며, OAuth 프로젝트에는 Content ID API 사용 권한이 있어야 합니다.

광수미디어 인계 전 Google OAuth 앱을 테스트 상태가 아닌 프로덕션으로 게시하고, 게시 후 새 토큰을 발급해 장기 갱신 여부를 확인해야 합니다. Content Owner 권한과 Reporting API 작업 목록은 OAuth 프로젝트와 별개로 YouTube 측에 유지되지만, 인증 파일과 토큰은 새 OAuth 클라이언트 기준으로 관리합니다.
