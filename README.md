# YouTube Reporting API Prototype

이 프로젝트는 YouTube Reporting API를 사용하여 채널 및 CMS(Content Management System) 리포트를 자동으로 생성하고 관리하기 위한 프로토타입 도구입니다.

## 🚀 주요 기능

- **인증 및 토큰 관리**: OAuth 2.0을 사용한 사용자 인증 및 `token.json` 저장/갱신
- **CMS ID 조회**: YouTube Content ID API를 연동하여 현재 계정이 관리하는 CMS ID(Content Owner ID) 자동 조회
- **리포트 타입 확인**: 사용 가능한 리포트 종류(`content_owner_`, `channel_`) 목록 확인 및 로그 기록
- **작업(Job) 생성**: 특정 리포트 타입에 대한 정기적인 리포팅 작업 생성
- **리포트 다운로드**: 생성된 리포트 목록 조회 및 실제 데이터 다운로드
- **리포트 분석**: 다운로드된 CSV 리포트를 분석하여 날짜별/채널별/자산별 수입 합계 및 분석 결과 제공

## 🛠️ 설치 및 설정

### 1. 사전 요구사항
- Node.js 설치 (v18+ 권장)
- [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
- 다음 API 활성화:
  - YouTube Reporting API
  - YouTube Content ID API (CMS 데이터 조회용)
- OAuth 2.0 클라이언트 ID 생성 및 `credentials.json` 파일 다운로드 후 프로젝트 루트에 배치

### 2. 패키지 설치
```bash
npm install
```

## 📖 사용 방법

### A. 인증 (Initial Auth)
처음 실행하거나 권한이 변경되었을 때 실행합니다.
```bash
npx tsx src/reAuth.ts
```

### B. 8개 리포트 작업(Job) 등록하기
리포트가 생성되려면 먼저 YouTube에 해당 리포트 타입을 "구독(Job 생성)"해야 합니다.
```bash
npx tsx src/createJob.ts
```
*※ 팁: 8가지 종류의 리포트가 필요하다면 `src/createJob.ts`에서 각 `reportTypeId`를 변경하며 실행하세요.*

### C. 리포트 한 번에 다운로드 (날짜 지정 포함)
등록된 모든 Job의 리포트 데이터를 한꺼번에 다운로드합니다. 
특히 **"과거 특정 기간(예: 1/13~2/27)"**의 데이터만 받고 싶을 때 유용합니다.

1. `src/getReports.ts` 파일을 엽니다.
2. 상단 설정값을 원하는 기간으로 수정합니다:
   ```typescript
   const START_DATE = "2026-01-13"; // 시작일
   const END_DATE = "2026-02-27";   // 종료일
   ```
3. 다음 명령어를 실행합니다:
   ```bash
   npm run get-reports
   # 또는 npx tsx src/getReports.ts
   ```
   *※ 오늘이 3/26이더라도, 위 날짜를 "2026-01-13"~"2026-02-27"로 설정하면 해당 기간의 리포트만 `reports/` 폴더에 차곡차곡 저장됩니다.*

### D. 클라이언트 제출용 CSV 추출 (최종 결과물 8종)
다운로드된 원본 리포트들(`reports/` 폴더 내 파일)을 가공하여 클라이언트가 요구하는 형식의 CSV로 변환합니다.

#### 1) 인접저작권용 (Neighboring - 4종)
1. `src/extractCsvs.ts` 파일을 열어 `START_DATE`, `END_DATE`를 설정합니다.
2. 실행: `npx tsx src/extractCsvs.ts`
   - 생성 파일: `1_neighboring_daily_ad.csv`, `2_neighboring_daily_ad_alt.csv`, `3_neighboring_monthly_sub.csv`, `4_neighboring_daily_video.csv`

#### 2) 퍼블리싱용 (Publishing - 4종)
1. `src/extractPublishingCsvs.ts` 파일을 열어 `START_DATE`, `END_DATE`를 설정합니다.
2. 실행: `npx tsx src/extractPublishingCsvs.ts`
   - 생성 파일: `1_publishing_daily_ad.csv`, `2_publishing_daily_ad_alt.csv`, `3_publishing_monthly_sub.csv`, `4_publishing_ddex_dsr.txt` (DDEX 저작권 포맷 포함)

## 📂 프로젝트 주요 파일 안내

- `src/getReports.ts`: 모든 Job의 리포트를 기간별로 필터링하여 **다운로드**하는 핵심 도구.
- `src/extractCsvs.ts`: **인접저작권(Neighboring)** 정산 데이터를 가공하는 도구.
- `src/extractPublishingCsvs.ts`: **퍼블리싱(Publishing)** 정산 및 저작권 데이터를 가공하는 도구.
- `reports/`: YouTube에서 직접 내려받은 원본 CSV 리포트들이 보관되는 폴더.

## ⚠️ 날짜 지정 팁 (Q&A)

**Q. 오늘이 3/26인데, 1/13~2/27 기간의 데이터를 받고 싶어요.**
- **A.** `src/getReports.ts`와 `src/extractCsvs.ts` 상단의 `START_DATE`를 `"2026-01-13"`, `END_DATE`를 `"2026-02-27"`로 설정하고 실행하세요. 코드가 파일명이나 리포트 시작 시간(startTime)을 읽어서 해당 범위에 속하는 데이터만 처리하도록 설계되어 있습니다.
