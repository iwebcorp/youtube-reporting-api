# 20260622 광수미디어 첨부 원본 대사

## 결론

광수미디어가 언급한 `GE 407.94728`은 국가 코드 `Country = GE`가 아니라, summary 파일의 `Revenue Type = GE` 항목이다.

첨부된 3번 상세 파일에는 해당 `Revenue Type = GE / Product = Subscriptions` 금액의 행 단위 상세가 없고, 3번 상세 파일 자체의 `Partner Revenue` 합계는 광수미디어가 확인한 정산 금액 `2113.6699`와 일치한다.

## 첨부 원본 합계

| 번호 | 파일 | 행 수 | Partner Revenue 합계 | 국가별 유의점 |
| ---: | --- | ---: | ---: | --- |
| 1 | `1.YouTube_kwangsoomedia_pla_M_20260501_20260531_rev_views_by_asset_v1-0.csv` | 19,434 | `2427.094716713960` | 전부 `Country = KR` |
| 2 | `2.YouTube_kwangsoomedia_pla_M_20260501_ADJ_asset_raw_v1-1.csv` | 550 | `1.470690689266` | 전부 `Country = KR` |
| 3 | `3.YouTube_kwangsoomedia_pla_M_20260501_20260531_red_pubs_rawdata_asset_v1-1.csv` | 49,415 | `2113.669986638649` | `KR` 외 국가 행은 있으나 수익 합계는 `0`; 수익은 전부 `KR` |
| 4 | `4.YouTube_kwangsoomedia_pla_20260501_HardwareAudioTierRevenue.csv` | 498 | `2.626366422495` | 전부 `Country = KR` |

## Summary 파일 구독 항목

`YouTube_kwangsoomedia_pla_20260501_summary.csv` 기준 구독 항목은 다음과 같다.

| Revenue Type | Product | Country | Partner Revenue |
| --- | --- | --- | ---: |
| `GE` | `Subscriptions` | `KR` | `407.947280959364` |
| `GE Music` | `Subscriptions` | `KR` | `348.681362131246` |
| `Music` | `Subscriptions` | `KR` | `1764.988624507425` |

합계:

```text
407.947280959364 + 348.681362131246 + 1764.988624507425
= 2521.617267598035
```

3번 상세 파일 합계:

```text
348.681362131246 + 1764.988624507425
= 2113.669986638671
```

따라서 광수미디어가 말한 `2521.6172 - 407.94728 = 2113.6699` 구조가 첨부 원본에서 재현된다.

## 해석

- `407.94728`은 한국 외 국가 발생분이 아니다.
- 해당 행의 `Country`는 `KR`이다.
- 문제의 `GE`는 국가 코드가 아니라 YouTube summary의 `Revenue Type`이다.
- 광수미디어가 다운로드한 3번 상세 파일에는 `Revenue Type = GE / Product = Subscriptions`의 상세 행이 제공되지 않는다.
- 따라서 3번 정산 상세 파일은 현재 첨부 원본 기준 `2113.6699`가 맞다.
