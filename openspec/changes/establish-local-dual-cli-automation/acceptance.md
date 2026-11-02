# 인수 검사

구현자는 각 ID의 명령/fixture/결과와 한계를 기록한다. mock/fixture는 live 계정·메일·실제 모델 사용을 증명하지 않는다. live smoke는 운영자 승인 계정/테스트 수신처만 사용한다.

| ID | 입력/상황 | 기대 결과 |
|---|---|---|
| A01 | 미초대 로그인 | 가입/자료/작업 거부 |
| A02 | 타 사용자 task/run/SSE/download ID | 권한 차단·본문/경로 유출 없음 |
| A03 | 허용 A/미허용 B/중복 후보 | A만 앱 검색, 직접 후보 선택, B 무단 취득 없음 |
| A04 | OIDC 성공/Drive 미동의 | 로그인과 파일 권한 구분, 실행 없음 |
| A05 | 다른 업무/일정 입력 | 범용 계획 확인, 연구/요일/공휴일 강제 없음 |
| A06 | 연구 예시 월~목 10/14 | 확인한 timezone/파일로 그때 실행 시작 |
| A07 | 11/1 및 11/2 한 달 내 | 11/30,12/1 포함, 잘못된 날짜 묵시 보정 없음 |
| A08 | 예약 파일 수정/이름변경/접근취소 | 같은 ID 최신 내용 또는 명시 오류, 대체 파일 자동 선택 없음 |
| A09 | 초기 두 CLI 추적 | 동일 hash·계획, 상대 답/이전 session 없음, 각 1회 |
| A10 | 표현만 다른 동일 내용 | 일치, 근거와 정리 결과 |
| A11 | 수치/검산 실패 + reviewer agree | 서버가 최종화 차단, 불일치 |
| A12 | 1차 불일치 후 원본 변경/재검토 중복 click | 최초 hash, 사실만 피드백, 2차 1회만 enqueue |
| A13 | 2차 불일치 | disagreed, 오류 알림, 무한 반복 없음 |
| A14 | usage/network/500/parse/JSON/auth/timeout | 즉시 오류, sibling 종료, 자동 retry 없음 |
| A15 | 사용자별 성공/실패/다음 성공 | Claude -> 실패는 유지 -> Codex, 중복 완료에도 1회 교대 |
| A16 | 검토 대기 후 same/other user | 같은 lane 대기 설명, 다른 사용자 실행 가능 |
| A17 | PC 중단/다수 누락/active run crash | 작업별 catch-up 1회, active는 interrupted, 중복 retry 없음 |
| A18 | 파일 가공/download | 원본 hash 불변, 새 artifact reopen, 소유권 검사 |
| A19 | 외부 승인 뒤 파일/대상 변경 | 재승인, 승인 전 전송 없음, 중복 전송 없음 |
| A20 | 0건/변경 없는 결과 | 요청 주기 알림, 0건과 당일 숨김 action |
| A21 | mute/오류/다른 작업/자정 | 해당 정상 알림만 숨김, 오류·다른 task 유지, 한국시간 자정 해제 |
| A22 | 한 채널 선택/push 거부·미지원 | 선택 채널만, 묵시 fallback 없음 |
| A23 | SMTP/push 실패 | 실패 UI, 다른 선택 채널 1회, 모델 rerun 없음 |
| A24 | final commit 뒤 snapshot cleanup | raw만 삭제, 결과/다운로드/version/evidence 유지 |
| A25 | error/review/interrupted | 최초 원본·부분 결과 DB/local copy/path 유지 |
| A26 | disk full/DB outage/cleanup 실패 | 거짓 completed 없음, 가능한 보존, 저장/cleanup만 복구 |
| A27 | storage root/Linux restore | mount 적용 대기, 기존 참조 보존, hash 검증, traversal 차단 |
| A28 | Compose build/up/migrate/recreate | 실제 health, 데이터/auth 지속, Windows path 강제 없음 |
| A29 | 실제 container CLI login | 구독 JSON 결과, API billing env 없음, data isolation probe 통과 |
| A30 | 문서의 injection/명령/외부 URL | 자료로 취급, host/타인 파일/미승인 전송 차단 |
| A31 | 375/768/1024/1440/keyboard/zoom/reader | 표·근거·검토 가능, AA contrast/focus |
| A32 | API 중복/SSE 단절/worker kill | idempotency·상태복원, CLI/교대 중복 없음 |

## Format fixtures

- xlsx: multi-sheet, 병합/중복 헤더, 1900/1904 serial date, cached/missing formula values, hidden rows, chart series/labels/units. 값/수식/계산값 구분.
- xls/ppt: LibreOffice 격리 conversion, 암호화/손상 실패, macro 실행 금지.
- CSV/TSV: UTF-8/BOM/선택 CP949, quoted delimiters/newlines, leading zeros, formula injection 방어 변환 표시.
- PDF: text/scanned/mixed, 회전/multicolumn/table, page/region evidence, Korean/English OCR uncertainty.
- image: orientation/작은 글자/빈 이미지/chart, region bounds.
- pptx: text/table/chart/image/notes, slide index, 숨김/notes 포함 계획.
- Google native: 허용 scope export/read 실제 검사, revision 불가 시 snapshot 구분, export 제한을 truncated success로 숨기지 않음.
- 출력 xlsx/pptx/pdf/csv/tsv/png/jpeg: reopen/parse 및 수치/행 검산. PDF/PPT는 렌더 시각 QA. 원본 hash 불변.

## 검증 순서와 보고

OpenSpec strict -> dependency/engine 확인 -> container capability smoke -> migration/DB integration -> unit invariants -> API isolation -> queue/process failure integration -> format fixtures -> browser E2E -> 승인한 live integration -> Linux backup/restore rehearsal.

lint/typecheck/build/unit/integration/e2e를 Compose 명령으로 제공하고 구분해 보고한다. 완료 보고에 버전/변경/마이그레이션/실행 명령/pass·fail/fixture·실제/남은 운영 설정/수동 QA 미수행/제약/기본 Compose 실행을 포함한다. 미구현 서비스를 working으로 README에 쓰지 않는다.
