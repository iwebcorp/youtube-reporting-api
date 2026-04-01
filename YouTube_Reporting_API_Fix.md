## 1. CMS ID (Content Owner ID) 찾는 법

CMS ID를 찾기 어려우신 분들을 위해 자동 조회 도구를 만들었습니다. 아래 순서대로 진행하세요.

### A. YouTube Content ID API 활성화
1. [Google Cloud Console](https://console.cloud.google.com/apis/library/youtubepartner.googleapis.com)에 접속합니다.
2. **"YouTube Content ID API"**를 검색하여 **사용** 버튼을 누릅니다.

### B. 재인증 (새로운 권한 획득)
CMS 정보를 가져오는 권한을 추가했으므로, 기존 토큰을 삭제하고 다시 로그인해야 합니다.
```bash
npx tsx src/reAuth.ts
```

### C. CMS ID 조회 스크립트 실행
```bash
npx tsx src/findCmsId.ts
```
조회에 성공하면 `CMS ID (ㅇㅇㅇ-xxx...)` 형태의 문자열이 나옵니다. 이를 복사하세요.

## 2. 코드에 CMS ID 적용하기

`src/createJob.ts`와 `src/getReports.ts` 파일을 열어 `onBehalfOfContentOwner: "CMS_ID_HERE"` 부분을 방금 복사한 ID로 수정합니다.

```typescript
onBehalfOfContentOwner: "방금_복사한_ID",
```

## 3. Google Cloud Console 설정

1. [Google Cloud Console](https://console.cloud.google.com/apis/library/youtubereporting.googleapis.com)에서 **YouTube Reporting API**가 '사용' 상태인지 다시 한번 확인해 주세요.
2. 현재 로그인한 구글 계정이 해당 CMS의 **관리자 또는 관리 권한**이 있는 계정인지 확인해 주세요.

## 4. 진단 도구 실행

제가 현재 폴더에 `src/listReportTypes.ts` 라는 진단용 파일을 만들어 두었습니다. 이를 실행하여 현재 계정으로 어떤 리포트들을 볼 수 있는지 먼저 확인해 보세요.

```bash
npx tsx src/listReportTypes.ts
```

이 명령어를 실행하면 `report_types.log` 파일이 생성됩니다. 그 안에 `content_owner_`로 시작하는 리포트 타입들이 보이지 않는다면, **CMS ID가 반드시 필요하다는 증거**입니다.

---

**수정한 내용 요약:**
1. `src/getReports.ts`: 타입 에러 수정 및 다운로드 경로 출력 추가.
2. `src/createJob.ts`: `onBehalfOfContentOwner` 파라미터(자리표시자) 추가.
3. `src/listReportTypes.ts`: 현재 권한으로 접근 가능한 리포트를 확인하는 진단 도구 추가.
