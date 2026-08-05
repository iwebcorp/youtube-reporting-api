# 월별 정산 로컬 GUI 사용법

## 실행

프로젝트 폴더에서 `start-gui.cmd`를 더블클릭한다. 로컬 서버가 실행되면 기본 브라우저에서 아래 주소가 열린다.

```text
http://127.0.0.1:43127
```

브라우저가 자동으로 열리지 않으면 위 주소를 직접 연다. 창을 닫아도 작업은 계속되며, 실행 중인 명령 프롬프트 창을 닫으면 로컬 서버도 종료된다.

## 작업 순서

1. `정산 대상 월`에서 연도와 월만 선택한다.
2. 필요한 단계를 선택한다.
3. `선택 단계 실행`을 누른다.
4. 실행 로그와 단계 상태를 확인한다.
5. 완료 후 `결과 폴더 열기`를 누른다.

단계별 역할은 다음과 같다.

| 단계 | 역할 | 독립 실행 |
| --- | --- | --- |
| Raw Data | 일별 수익 및 자산 사용량 파일을 다운로드한다. | 가능하다. |
| System-managed Data | 일반 7종, PLA 5종, 자산 메타데이터 1종을 다운로드한다. | 가능하다. |
| 정산 파일 추출 | 9개 전달 파일과 GE 총액 요약을 생성한다. | Raw와 System-managed가 준비된 경우에만 가능하다. |

정산 파일 추출을 선택했는데 선행 파일이 부족하면 필요한 다운로드 단계가 자동 선택된다. 이미 준비된 단계는 다시 선택하지 않는다.

## 준비 상태 기준

- Raw Data는 대상 월의 매일마다 `content_owner_asset_estimated_revenue_a1`과 `content_owner_asset_combined_a3`가 모두 존재하고 파일 크기가 0보다 커야 한다.
- System-managed Data는 일반 7종, PLA 5종, 월말 자산 메타데이터 1종이 모두 존재하고 파일 크기가 0보다 커야 한다.
- `.partial` 다운로드 파일이 남아 있으면 해당 단계는 준비 완료로 판단하지 않는다.
- 정산 파일 추출은 9개 전달 파일과 `publishing_ge_summary.csv`까지 총 10개를 완료 상태로 확인한다.

보고서가 아직 YouTube에서 발행되지 않았다면 System-managed 단계가 미완료로 종료된다. 이 경우 추출을 강제로 진행하지 않고 보고서 발행 후 같은 월로 다시 실행한다.

## 터미널 실행

GUI 없이 단계만 선택하려면 아래 형식을 사용한다.

```powershell
npm.cmd run monthly-settlement -- --yearMonth=202607 --steps=raw
npm.cmd run monthly-settlement -- --yearMonth=202607 --steps=managed
npm.cmd run monthly-settlement -- --yearMonth=202607 --steps=extract
npm.cmd run monthly-settlement -- --yearMonth=202607 --steps=raw,managed,extract
```

`--steps`를 생략하면 기존과 동일하게 전체 단계를 실행한다.
