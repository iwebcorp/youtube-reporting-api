# YouTube Reporting API Prototype

이 프로젝트는 YouTube Reporting API를 사용하여 채널 및 CMS(Content Management System) 리포트를 자동으로 생성하고 관리하기 위한 프로토타입 도구입니다.

## 🚀 주요 기능

- **인증 및 토큰 관리**: OAuth 2.0을 사용한 사용자 인증 및 `token.json` 저장/갱신
- **CMS ID 조회**: YouTube Content ID API를 연동하여 현재 계정이 관리하는 CMS ID(Content Owner ID) 자동 조회
- **리포트 타입 확인**: 사용 가능한 리포트 종류(`content_owner_`, `channel_`) 목록 확인 및 로그 기록
- **작업(Job) 생성**: 특정 리포트 타입에 대한 정기적인 리포팅 작업 생성
- **리포트 다운로드**: 생성된 리포트 목록 조회 및 실제 데이터 다운로드

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
npm start
# 또는 
npx tsx src/reAuth.ts
```

### B. CMS ID 찾기 (Content Owner 전용)
CMS 리포트에 접근하기 위해서는 `onBehalfOfContentOwner` 파라미터에 들어갈 ID가 필요합니다.
```bash
npx tsx src/findCmsId.ts
```
조회된 ID를 복사하여 `src/createJob.ts` 및 `src/getReports.ts`의 `onBehalfOfContentOwner` 값으로 설정하세요.

### C. 가용한 리포트 확인 (진단 도구)
현재 계정으로 어떤 리포트를 생성할 수 있는지 확인합니다.
```bash
npx tsx src/listReportTypes.ts
```
상세 내용은 `report_types.log` 또는 `report_types_cms.log`에서 확인할 수 있습니다.

### D. 리포팅 작업 생성
```bash
npm run create-job
```

### E. 리포트 목록 및 다운로드
```bash
npm run get-reports
```

## 📂 프로젝트 구조

```text
src/
├── auth.ts           # OAuth 2.0 인증 로직
├── reAuth.ts         # 토큰 초기화 및 재인증
├── findCmsId.ts      # CMS ID(Content Owner) 조회
├── listReportTypes.ts # 가용한 리포트 종류 확인
├── createJob.ts      # 리포팅 작업 생성
├── getReports.ts     # 생성된 리포트 조회 및 다운로드
└── index.ts          # 메인 진입점
```

## ⚠️ 주의사항
- `credentials.json`과 `token.json`은 보안에 민감한 파일이므로 절대 공개 저장소에 올리지 마세요. (`.gitignore` 확인 필수)
- 리포트 작업(Job)을 생성한 후 실제 데이터가 쌓이기까지는 최대 48시간이 소요될 수 있습니다.
- CMS 리포트는 반드시 해당 채널이 속한 CMS 계정의 관리자 권한이 필요합니다.
