[GUI] 202607 실행 시작. 단계: managed
[MonthlySettlement] Selected stages: managed
[MonthlySettlement] STAGE managed START
[MonthlySettlement] 일반 system-managed 다운로드
[Config] 설정 로드 완료 — 정산기간: 2026-03-01 ~ 2026-03-31, 환율: 1380, 원천세율: 10%
[SystemManaged] yearMonth=202607 dir=C:\Users\iweb\youtube-API-prototype\reports\system-managed
[SystemManaged] contentOwnerId=2jFu0i9K0PE3MDrkU_UUfQ
[SystemManaged] target report types: content_owner_asset_ad_revenue_raw_a1, content_owner_asset_ad_adjustment_revenue_raw_a1, music_content_owner_asset_red_revenue_raw_a1, music_content_owner_asset_red_adjustment_revenue_raw_a1, content_owner_claim_audio_tier_revenue_raw_a1, content_owner_claim_audio_tier_revenue_summary_a1, music_content_owner_shorts_revenue_summary_a1
[SystemManaged] latestOnly=false
[SystemManaged] Download failed. GaxiosError: deleted_client
at Gaxios.\_request (C:\Users\iweb\youtube-API-prototype\node_modules\gaxios\src\gaxios.ts:213:15)
at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
at async OAuth2Client.refreshTokenNoCache (C:\Users\iweb\youtube-API-prototype\node_modules\google-auth-library\build\src\auth\oauth2client.js:259:19)
at async OAuth2Client.getRequestMetadataAsync (C:\Users\iweb\youtube-API-prototype\node_modules\google-auth-library\build\src\auth\oauth2client.js:372:17)
at async OAuth2Client.requestAsync (C:\Users\iweb\youtube-API-prototype\node_modules\google-auth-library\build\src\auth\oauth2client.js:457:23)
at async createAPIRequestAsync (C:\Users\iweb\youtube-API-prototype\node_modules\googleapis-common\build\src\apirequest.js:308:25)
at async withRetries (C:\Users\iweb\youtube-API-prototype\src\downloadSystemManagedReports.ts:135:14)
at async run (C:\Users\iweb\youtube-API-prototype\src\downloadSystemManagedReports.ts:180:22) {
config: {
retry: true,
retryConfig: {
httpMethodsToRetry: [Array],
currentRetryAttempt: 0,
retry: 3,
noResponseRetries: 2,
retryDelayMultiplier: 2,
timeOfFirstRequest: 1785904191825,
totalTimeout: 9007199254740991,
maxRetryDelay: 9007199254740991,
statusCodesToRetry: [Array]
},
method: 'POST',
url: URL {
href: 'https://oauth2.googleapis.com/token',
origin: 'https://oauth2.googleapis.com',
protocol: 'https:',
username: '',
password: '',
host: 'oauth2.googleapis.com',
hostname: 'oauth2.googleapis.com',
port: '',
pathname: '/token',
search: '',
searchParams: URLSearchParams {},
hash: ''
},
data: URLSearchParams {
'refresh_token' => '<REDACTED>',
'client_id' => '218859518321-adhtrr0dre7i4148nc9kj0vcjcvjng73.apps.googleusercontent.com',
'client_secret' => '<<REDACTED> - See `errorRedactor` option in `gaxios` for configuration>.',
'grant_type' => '<<REDACTED> - See `errorRedactor` option in `gaxios` for configuration>.' },
body: URLSearchParams {
'refresh_token' => '<REDACTED>',
'client_id' => '218859518321-adhtrr0dre7i4148nc9kj0vcjcvjng73.apps.googleusercontent.com',
'client_secret' => '<<REDACTED> - See `errorRedactor` option in `gaxios` for configuration>.',
'grant_type' => '<<REDACTED> - See `errorRedactor` option in `gaxios` for configuration>.' },
validateStatus: [Function: validateStatus],
responseType: 'unknown',
errorRedactor: [Function: defaultErrorRedactor],
duplex: 'half',
headers: Headers {
'x-goog-api-client': 'gl-node/24.14.0',
'User-Agent': 'google-api-nodejs-client/10.6.2'
}
},
response: Response {
size: 0,
data: {
error: 'deleted_client',
error_description: 'The OAuth client was deleted.'
},
config: {
retry: true,
retryConfig: [Object],
method: 'POST',
url: URL {},
data: [Object],
body: [Object],
validateStatus: [Function: validateStatus],
responseType: 'unknown',
errorRedactor: [Function: defaultErrorRedactor],
duplex: 'half',
headers: Headers {
'x-goog-api-client': 'gl-node/24.14.0',
'User-Agent': 'google-api-nodejs-client/10.6.2'
}
},
Symbol(Body internals): {
body: [Gunzip],
stream: [Gunzip],
boundary: null,
disturbed: true,
error: null
},
Symbol(Response internals): {
type: 'default',
url: 'https://oauth2.googleapis.com/token',
status: 401,
statusText: 'Unauthorized',
headers: [Object],
counter: 0,
highWaterMark: 16384
}
},
code: 401,
status: 401,
error: undefined,
Symbol(gaxios-gaxios-error): '7.1.4',
[cause]: { message: 'deleted_client', code: 401, status: 'Unauthorized' }
}
Error: [MonthlySettlement] Step failed: 일반 system-managed 다운로드. exitCode=1
at runTsxStep (C:\Users\iweb\youtube-API-prototype\src\runMonthlySettlement.ts:72:11)
at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
at async run (C:\Users\iweb\youtube-API-prototype\src\runMonthlySettlement.ts:128:5)
[GUI] 작업이 중단되었습니다. exitCode=1
