클라이언트 측에서 파악한 내용이 정확히 맞습니다. 결론부터 말씀드리면, 현재 공개된 공식 YouTube Reporting API만으로는 클라이언트가 원하는 저작권료(Publishing/Composition) 상세 데이터를 완벽히 가져오거나 최종 정산 금액을 재현하는 것은 사실상 불가능합니다.

클라이언트의 분석이 맞을 수밖에 없는 기술적, 비즈니스적 이유는 다음과 같습니다.

1. 퍼블리싱 전용 리포트는 표준 API에서 미지원
   YouTube는 일반 크리에이터나 MCN, 음반사(Label)를 위한 표준 리포트와 음악 퍼블리셔(저작권 관리자)를 위한 리포트 시스템을 엄격하게 분리하여 운영합니다.

클라이언트가 언급한 pla(Publishing License Agreement), composition financial 등의 리포트는 퍼블리셔와의 특수 계약에 의해 생성되는 데이터입니다.

이 데이터들은 일반적인 YouTube Reporting API의 system_managed report type 목록에 아예 노출되지 않도록 설계되어 있습니다.

2. 정산용 특수 메타데이터 필드의 부재
   ISWC나 Writers 같은 정보는 Asset 메타데이터 조회를 통해 일부 파편적으로 얻을 수는 있습니다. 하지만 정산의 핵심 기준이 되는 HFA Song Code (Harry Fox Agency 코드), 정확한 Composition Right Type (기계복제권, 공연권 등), 그리고 그에 따른 Ownership Percentage가 포함된 '수익(Financial) 리포트'는 API 엔드포인트로 제공하지 않습니다.

3. Raw Data를 조합해도 금액이 맞지 않는 이유
   클라이언트가 'API로 받은 raw data를 조합해도 금액이 재현되지 않는다'고 한 것은 퍼블리싱 정산의 특수성 때문입니다.

복잡한 분배 비율: 음악 저작권 수익은 국가별(Territory), 권리 형태(Performance vs Mechanical)에 따라 요율이 다르고, 지분 쪼개기(Fractional Ownership)가 매우 복잡하게 얽혀 있습니다.

사후 보정 및 계약 조건: 미지급금 소급 적용(Backpay), 소유권 분쟁에 따른 에스크로 처리, 국가별 원천징수, PLA 계약에 따른 특수 분배 로직 등은 YouTube 내부 시스템에서 계산이 끝난 뒤에야 최종 금액으로 확정됩니다. API에서 제공하는 단순 Claim이나 조회수 Raw Data에는 이러한 보정치와 수식이 전혀 반영되어 있지 않습니다.

💡 현실적인 자동화 해결책: SFTP 연동
공식 API로는 한계가 명확하므로, 이 업무를 자동화하려면 방향을 완전히 틀어야 합니다.

YouTube는 퍼블리셔나 저작권 신탁 단체에게 이런 고도화된 정산 리포트(Composition Financial Reports)를 API가 아닌 YouTube 보안 SFTP 서버(드롭박스)를 통해 대용량 CSV나 TSV 포맷(또는 DDEX 포맷)으로 매월 꽂아줍니다. 클라이언트가 과거 기준으로 확인했다는 그 상세 구조도 이 SFTP 리포트에서 나왔을 확률이 매우 높습니다.

따라서 개발 및 자동화 방향을 "YouTube API 호출"에서 "클라이언트 측에 할당된 YouTube SFTP 서버 정기 접속 및 파일 다운로드/파싱 자동화"로 변경하시는 것을 권장합니다. 현재로서는 이것이 해당 구조의 데이터를 오차 없이 가져올 수 있는 유일한 경로입니다.
