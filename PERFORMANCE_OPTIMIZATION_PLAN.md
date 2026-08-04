# 월별 정산 추출 성능 개선 계획서

## 1. 목적

`src/extractMonthlyClientPackage.ts` 실행 시간을 단축하되, 현재 승인된 정산 산출물의 내용과 형식을 변경하지 않는다.

현재 측정된 주요 소요 시간은 다음과 같다.

| 작업 | 측정 시간 |
| --- | ---: |
| Neighboring 1~4 추출 | 약 10분 |
| Publishing 1~3 추출 | 30분 이상 |
| Shorts 추출 | 약 2.5초 |
| 최종 정산 검증 | 약 2분 18초 |

가장 큰 병목은 Publishing 추출 과정에서 약 85MB인 일별 사용량 CSV 30개, 총 약 2.5GB를 순차적으로 해석하는 부분이다.

## 2. 최우선 원칙

1. 승인된 기존 산출물은 덮어쓰지 않는다.
2. 금액 계산식, 필터 조건, 집계 키 및 파일 작성 순서는 변경하지 않는다.
3. 최적화 전후의 8개 산출물이 SHA-256 기준으로 모두 일치해야 한다.
4. 파일 하나라도 다르면 해당 최적화는 채택하지 않는다.
5. 여러 최적화를 한 번에 적용하지 않고 단계별로 적용하고 검증한다.
6. 실행 시간 단축보다 결과물 보존을 우선한다.

## 3. 기준 산출물

6월 승인 결과와 일치함이 확인된 아래 폴더를 회귀검증 기준으로 사용한다.

```text
reports_regression_202606_client_pla_8files/
reports_regression_202606_publishing_ge/
```

최적화 테스트 결과는 기존 폴더와 다른 새 폴더에 생성한다. 기준 폴더를 입력 또는 출력 경로로 재사용하지 않는다.

비교 대상은 다음 8개 파일과 GE 요약 파일이다.

```text
1_neighboring_daily_ad.csv
1_publishing_daily_ad.csv
2_neighboring_daily_ad_adj.csv
2_publishing_daily_ad_adj.csv
3_neighboring_monthly_sub.csv
3_publishing_monthly_sub.csv
4_neighboring_financial_detail.csv
5_publishing_shorts_revenue_summary.csv
publishing_ge_summary.csv
```

## 4. 1차 최적화 범위

### 대상

`src/reporting/parsers.ts`의 `buildPublishingUsageCacheFromReports()`를 우선 대상으로 한다.

현재는 CSV의 각 행에서 필요한 값을 찾을 때마다 모든 컬럼명을 다시 순회하고 정규화한다. 한 행에서 같은 작업이 여러 번 반복되므로 대용량 파일에서 CPU 사용 시간이 크게 증가한다.

### 변경 방안

1. CSV 헤더를 파일당 한 번만 해석한다.
2. `asset_id`, `country_code`, `views`, `red_views`, `playback_location_type`, `live_or_on_demand` 컬럼 위치를 한 번만 결정한다.
3. 각 행에서는 이미 결정된 컬럼을 직접 읽는다.
4. 필수 컬럼이 없으면 잘못된 결과를 만들지 않고 즉시 오류로 종료한다.
5. 숫자 변환, 국가 코드 기본값, 집계 키, 조회수 합산 순서와 기존 fallback 동작은 유지한다.

### 1차 범위에서 하지 않는 변경

- 일별 사용량 파일 일부 제외.
- 특정 Asset ID 사전 필터링.
- 여러 파일 병렬 처리.
- 월별 캐시 도입.
- 금액 또는 조회수 계산식 변경.
- Neighboring, Shorts, GE 추출 로직 변경.
- 출력 CSV 컬럼, 정렬, 인코딩 또는 숫자 자릿수 변경.

## 5. 구현 및 검증 순서

1. 현재 코드로 6월 기준 실행 시간과 기준 산출물 SHA-256을 기록한다.
2. Publishing 컬럼 해석 최적화만 별도 변경으로 적용한다.
3. 동일한 6월 원천 데이터로 새 출력 폴더에 전체 패키지를 생성한다.
4. 최적화 전후 실행 시간을 같은 조건에서 측정한다.
5. 8개 정산 파일과 GE 요약 파일의 SHA-256을 비교한다.
6. 파일별 행 수, 헤더, 파일 크기 및 금액 합계를 추가로 비교한다.
7. `validate-settlement-package`를 실행해 `difference=0`인지 확인한다.
8. 모든 검증을 통과하고 실제 시간 단축이 확인된 경우에만 변경을 유지한다.

## 6. 통과 기준

다음 조건을 모두 만족해야 1차 최적화를 채택한다.

- 기존 승인 기준 8개 파일과 신규 8개 파일의 SHA-256이 전부 일치한다.
- GE 요약 파일의 SHA-256이 일치한다.
- 파일 개수, 파일명, 헤더, 행 수 및 파일 크기가 일치한다.
- 정산 검증 결과가 `difference=0.000000000`이다.
- Publishing 및 전체 패키지 실행 시간이 기존보다 단축된다.
- 실행 중 새 경고, 누락 파일 또는 파싱 오류가 발생하지 않는다.

SHA-256이 일치하면 파일 내용이 바이트 단위로 동일한 것으로 판단한다. 금액 합계만 같은 경우에는 통과로 인정하지 않는다.

## 7. 실패 시 처리

다음 중 하나라도 발생하면 최적화 코드를 채택하지 않는다.

- SHA-256 불일치.
- 행 순서 또는 숫자 표기 변경.
- 합계 차이 발생.
- 일부 월 또는 일부 CSV 헤더를 처리하지 못함.
- 유의미한 실행 시간 단축이 없음.

실패한 테스트 산출물은 승인 산출물과 구분해 보관하거나 삭제하고, 변경 전 코드로 동일 검증을 다시 실행해 기준 상태를 확인한다.

## 8. 후속 최적화 후보

1차 최적화가 통과한 이후에만 아래 항목을 각각 독립적으로 검토한다.

1. Publishing 정산 대상 Asset ID 사전 필터링.
2. 일별 집계 결과를 저장하는 월별 캐시.
3. 2~4개 워커를 이용한 파일 단위 병렬 처리.
4. Neighboring 사용량 처리에 동일한 헤더 캐시 적용.
5. 검증 단계에서 추출 시 계산한 합계를 재사용하는 방식.

각 후속 변경도 동일하게 별도 적용, 전체 재추출, SHA-256 비교 순서로 검증한다. 6월 하루치 사용량 파일만 사용해도 기존 파일과 일치했던 실험 결과는 최적화 근거로 사용하지 않는다. 나머지 일별 파일이 불필요하다는 사실이 입증되지 않았기 때문이다.

## 9. 예상 결과

1차 최적화만으로 달성할 정확한 시간은 벤치마크 전에는 확정하지 않는다. 목표는 Publishing 파싱 시간을 유의미하게 줄이면서 산출물 SHA-256을 그대로 유지하는 것이다.

전체 실행 시간의 하한에는 약 10분인 Neighboring 추출과 약 2분인 검증 시간이 포함된다. 전체 실행을 10분 이하로 줄이려면 1차 검증 이후 Neighboring과 검증 단계도 별도로 최적화해야 한다.

## 10. 1차 최적화 구현 결과

### 구현 상태

1차 최적화는 모든 결과 보존 및 성능 통과 기준을 만족해 채택했다.

변경 파일은 `src/reporting/parsers.ts`이며, 변경 대상은 `buildPublishingUsageCacheFromReports()`로 한정했다.

- 기존에는 각 데이터 행에서 `findFirstValue()`를 여섯 번 호출하며 전체 컬럼명을 반복 순회하고 정규화했다.
- 변경 후에는 각 CSV의 첫 행을 헤더로 한 번만 해석한다.
- `asset_id`, `country_code` 또는 `country`, `views`, `red_views`, `playback_location_type`, `live_or_on_demand`의 컬럼 인덱스를 파일별로 한 번 결정한다.
- 이후 각 데이터 행에서는 결정된 인덱스로 값을 직접 읽는다.
- 필수 컬럼이나 헤더 행이 없으면 해당 파일 경로와 누락 컬럼을 포함한 오류로 즉시 종료한다.

다음 로직은 변경하지 않았다.

- 숫자 변환과 잘못된 숫자의 `0` fallback 동작.
- 국가 코드가 비어 있을 때 `XX`를 사용하는 동작.
- `assetId|country` 집계 키.
- 조회수와 광고 가능 조회수 계산식.
- 재생 위치 및 라이브·온디맨드 필터 조건.
- 파일 처리 순서와 행별 누적 순서.
- Publishing 대상 판별과 fallback 캐시 적용 순서.
- CSV 컬럼, 정렬, 인코딩, 개행 및 숫자 자릿수.
- Neighboring, Shorts 및 GE 추출 로직.

### 검증 폴더

승인 기준 산출물은 읽기 전용 비교 대상으로만 사용했다.

```text
reports_regression_202606_client_pla_8files/
reports_regression_202606_publishing_ge/
```

변경 전과 최적화 후 결과는 각각 별도 폴더에 생성했다.

```text
reports_perf_baseline_202606_client_pla_8files/
reports_perf_baseline_202606_publishing_ge/
reports_perf_optimized_202606_client_pla_8files/
reports_perf_optimized_202606_publishing_ge/
```

기존 승인 폴더에는 쓰기 작업을 하지 않았다.

## 11. 실행 시간 비교

동일한 2026년 6월 원천 데이터, Node.js 메모리 옵션, 실행 명령과 하드웨어를 사용하고 출력 폴더만 분리해 측정했다.

| 측정 대상 | 변경 전 | 최적화 후 | 단축 시간 | 개선율 |
| --- | ---: | ---: | ---: | ---: |
| 전체 8개 파일 패키지 생성 및 내장 검증 | 1,410.303초 | 572.427초 | 837.876초 | 59.4% |
| Publishing 1~3 생성 단계 | 1,162.486초 | 348.544초 | 813.942초 | 70.0% |

전체 패키지 시간은 프로세스 실행 전후의 `Stopwatch`로 측정했다. Publishing 단계 시간은 새 출력 폴더에서 Publishing 1~3 파일의 최초 생성 시각과 최종 쓰기 시각을 기준으로 산출했다.

## 12. SHA-256 회귀검증

최적화 결과와 승인 기준 파일을 비교한 결과, 8개 패키지 파일과 GE 요약 파일이 모두 바이트 단위로 일치했다.

| 파일 | SHA-256 | 결과 |
| --- | --- | --- |
| `1_neighboring_daily_ad.csv` | `D65EAD997D627304F3613F990F7C4B4B76F88D151BB5E3F23D7F9FAFF6DDBC5B` | 일치. |
| `1_publishing_daily_ad.csv` | `FA9B4652CFDD2A29182263E7FB62C4617B2DB7B7237F03CECF612470E2A57CD7` | 일치. |
| `2_neighboring_daily_ad_adj.csv` | `81329E79D7155D59E85CF3E06C3D03E07F7B1546DA050F40F4FA6226132F6E4F` | 일치. |
| `2_publishing_daily_ad_adj.csv` | `5ABBAF4893C3903332B88058D89FE16876171CF073291C5B42DC7825A8A40256` | 일치. |
| `3_neighboring_monthly_sub.csv` | `77CB72E3107123FBCF6478E52716D6917DF3C0C3C05ECF15EB5C4C56838DB8B0` | 일치. |
| `3_publishing_monthly_sub.csv` | `D17A7EF9AE12BEA88CCD88DC40E887E653AA983D525EEFDD31ECAF5D2A5ABD02` | 일치. |
| `4_neighboring_financial_detail.csv` | `E07BDA0907BD592F699099F7C3FC1869A4975A0E0C3E7A1B575C7C4EA0E8E0A1` | 일치. |
| `5_publishing_shorts_revenue_summary.csv` | `5724B4C76284BBC54484884CA74E4B06782EE1020D84F82F185738134850C3C1` | 일치. |
| `publishing_ge_summary.csv` | `BA3EEC1DAF0FCA5AEBEFDBDE2A02F4D3D4A57F18E87746F443D05822DD613825` | 일치. |

추가 구조 검증 결과도 모두 일치했다.

- 패키지 파일 수는 정확히 8개였다.
- GE 폴더의 파일 수는 정확히 1개였다.
- 파일별 크기, 헤더 및 행 수가 승인 기준과 일치했다.
- 제외 대상인 `4_publishing_ddex_dsr.csv`는 생성되지 않았다.
- 실행 중 새로운 경고, 누락 파일 또는 파싱 오류가 발생하지 않았다.

## 13. 정산 및 오류 처리 검증

최적화 결과 폴더를 대상으로 독립 정산 검증을 다시 실행했다.

```text
npm.cmd run validate-settlement-package -- --yearMonth=202606 --systemManagedDir=reports/system-managed --outputDir=reports_perf_optimized_202606_client_pla_8files
```

검증 결과는 다음과 같다.

```text
mainPackageTotal=112812.864160486
publishingReferenceTotal=4388.309905571
apiTotal=112812.864160486
difference=0.000000000
```

필수 컬럼 일부가 없는 임시 CSV로 오류 경로도 확인했다. `redViews`, `playbackLocationType`, `liveOrOnDemand`가 누락된 경우 `Missing required columns` 오류와 함께 종료했다.

`src/reporting/parsers.ts` 대상 TypeScript 검사는 통과했다. 전체 프로젝트 `tsc --noEmit`은 기존 분석·샘플 코드 오류로 실패했지만, 오류 목록에 변경 파일은 포함되지 않았다.

## 14. 채택 결론

다음 조건을 모두 충족했으므로 1차 최적화 코드를 유지한다.

- 승인 기준 8개 파일 및 GE 요약의 SHA-256 일치.
- 파일명, 파일 수, 헤더, 행 수 및 파일 크기 일치.
- 정산 검증 `difference=0.000000000` 통과.
- 전체 패키지와 Publishing 단계 실행 시간 단축.
- 계산식, 필터, 집계 순서 및 출력 형식 보존.

후속 최적화는 이 결과와 혼합하지 않고 제8절의 후보를 각각 독립적으로 적용한 뒤 동일한 전체 재추출 및 SHA-256 검증 절차를 거쳐야 한다.
