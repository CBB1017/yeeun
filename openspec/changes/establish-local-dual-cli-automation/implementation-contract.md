# Claude 구현 계약

## 권한과 문서 우선순위

사용자는 구현 전 명세 마무리를 Codex에 위임하고 코드 구현은 Claude에 맡겼다. 제품 코드는 추가하지 않는다. 기존 Compose db/tools 기반만 구현됐다. 이 문서는 이전 design.md의 미정 목록을 대체하는 현행 구현 결정이다. 사용자 확정 요구인 specs가 우선하고, 이 문서의 세부 결정이 과거 제안/역사 기록보다 우선한다. 계정 비밀값·실제 도메인·로그인은 운영자가 제공할 설정이며 제품 정책의 미정 항목이 아니다.

## 기술 결정

- TypeScript, SvelteKit adapter-node, shadcn-svelte, Tailwind CSS, PostgreSQL. npm과 package-lock.json, 재현 가능한 `npm ci`.
- Drizzle ORM + node-postgres, 버전 관리된 SQL migration. 별도 one-shot `migrate` 서비스가 적용하고 web/worker 시작 때 임의 schema push는 하지 않는다.
- pg-boss 기반 PostgreSQL 큐. Redis·별도 유료 큐를 추가하지 않는다. 큐의 자동 재시도/실패 job 자동 redelivery는 명시적으로 비활성화하고 앱 run claim으로 중복 CLI 실행도 차단한다.
- Compose 서비스: db, migrate, web, worker, 일회성 tools, 선택적 ngrok profile. web은 화면/API/SSE, worker는 스케줄·큐·파일·CLI·알림을 소유한다.
- 기존 검증 이미지 PostgreSQL 18.6, Node LTS 26.13.0 digest를 유지한다. 앱 라이브러리와 CLI는 구현 시 공식 최신 정식 안정버전 중 peer/engine 호환 조합을 검증하고 exact version/lockfile/image digest 및 docs/versions.md에 기록한다. beta/RC/nightly·build마다 latest 설치 금지. 중요한 스택 변경/유료 fallback은 사용자에게 확인한다.

## 작업 설정과 실행 상태

작업 설정은 draft -> needs_input -> ready. 자연어 원문에서 목표·허용 파일·범위·산출물·일정·시간대·알림을 사람이 검토할 수 있는 TaskPlan으로 만든다. 모호한 항목만 질문하며 사용자 확인 전 실행/예약을 활성화하지 않는다. 파일 선택은 등록된 허용 파일만 대상이며 연구 분석은 예시다.

자연어 계획 생성은 작업 생성 단계에서 현재 담당 CLI로 draft 1회를 얻을 수 있다. 이 호출은 '업무 설정'으로 별도 표시하고 실행 결과나 라운드로빈 성공으로 계산하지 않는다. 추가 사용량을 소비함을 UI에 알린다. 사용자가 질문에 답해 의미를 수정할 때만 재생성하고, 단순 선택/설정은 코드로 처리한다. 자유 텍스트를 shell 명령으로 변환하지 않는다.

실행 상태: queued -> preparing -> executing -> comparing -> finalizing -> completed. 첫 불일치는 awaiting_review, 요청 시 review_queued -> executing(round=2) -> comparing. 2차 불일치는 disagreed, 실행 오류 failed, 취소 cancelled, worker 비정상 중단 interrupted. 예외 상태를 성공으로 요약하지 않는다.

completed는 검산/대조 통과, 결과·근거·다운로드 파일 영속 저장 및 웹에서 소유자 접근 가능, DB 결과 포인터·알림 outbox commit까지 완료한 시점이다. 이메일 읽음/푸시 열람은 조건이 아니다. 전송 실패는 delivery_failed로 별도 표시하고 분석 성공/교대는 되돌리지 않는다. 이 완료 경계 후 원본 스냅샷을 삭제한다. 저장 실패면 완료하지 않는다.

## 큐·순환·중단

기본 전역 태스크 동시성 1, 태스크 안의 두 CLI는 독립 프로세스로 병렬 1회씩 실행한다. 두 결과 뒤 지정 담당의 대조·정리 1회다. 향후 TASK_CONCURRENCY 1–8 확장을 허용하되 사용자 lane은 1로 유지한다.

사용자별 nonterminal 실행은 1개다. awaiting_review는 전역 worker 슬롯을 놓되 사용자 lane을 유지하여 같은 사용자의 다음 작업은 대기한다. UI에 이유·검토/취소를 제공한다. 다른 사용자는 계속 실행한다. failed/disagreed/cancelled/interrupted는 terminal로 lane을 해제하지만 원본·결과는 보관한다. 이 규칙은 검토 대기 중 같은 담당이 중복 배정되어 성공 순서와 교대가 어긋나는 것을 방지한다.

사용자별 최초 담당 Claude. 완료 transaction에서 reviewer_state를 잠그고 정확히 1회 Codex/Claude 교대. 실패/불일치/취소는 교대하지 않는다. 재검토 담당은 유지한다. 새 수동 재실행은 새 run이며 예약 occurrence와 구분한다.

FIFO는 eligible_at, created_at, id 순서이며 막힌 사용자 lane만 건너뛴다. lease 60초, heartbeat 15초. CLI stage timeout 기본 30분(관리자 1–120분), 전체 task 기본 90분. 오류/취소/timeout은 양쪽 프로세스 종료 요청, 10초 뒤 강제 종료, 부분 결과 보관. 자동 작업 재시도 없음. 다음 정기 occurrence는 별도 실행하며 작업 pause 없이는 스케줄 자체를 폐기하지 않는다.

예약은 사용자 확인한 정규화 규칙·IANA timezone·revision으로 보관한다. 초기 timezone은 브라우저 제안을 확인받는다. 공휴일은 요청 시 국가/달력을 확인한다. 연구 예시의 30일 범위는 시작 날짜 포함 +29일이다. 누락 실행은 실제 실행 날짜 기준으로 상대 날짜를 계산하고 지연 실행임을 표시한다. 다른 기준일을 원하면 작업 계획에서 명시한다.

고유(task_id,schedule_revision,scheduled_for)로 발생 건을 기록한다. PC 중단 누락은 작업별 가장 최근 누락 occurrence를 대표로 1회 병합하고 누락 기간/개수를 기록한다. 같은 occurrence의 catch-up/정상 enqueue 중복 금지. 이미 실행 중이던 run은 재기동 시 interrupted로 기록하고 자동 재실행하지 않는다. 예약 누락 catch-up과 실패 retry는 별개다.

## 독립 실행과 대조

원본 byte 및 공통 파싱 manifest/hash를 실행마다 동결한다. 두 CLI는 같은 요청·계획·자료·근거를 받되 상대 답/이전 대화는 받지 않는다. 초기와 재검토 모두 새 CLI session을 사용하고 resume하지 않는다. 기본 2회 독립 호출 + 1회 reviewer 호출이며 재검토에도 동일하다.

재검토에는 최초 원본 hash를 유지하고 추가 피드백은 불일치 사실만 전달한다. 상대 답/쟁점/수정 지시/점수를 넣지 않는다. 2차 후 재검토 자동 반복 없음.

코드가 manifest/schema/evidence 참조·typed values를 먼저 검증한다. 수치·날짜·대상 검산 실패를 모델이 agree로 덮어쓸 수 없다. 값은 원본 decimal·명시된 단위/반올림으로 비교하고 임의 오차 허용 안 함. 표현/정렬 차이만 있고 핵심 사실·레코드·수치·근거가 같으면 일치 가능. 누락/원본 밖 수치/잘못된 출처/확인 불가능은 불일치다. 계산하지 못한 것을 검산 완료로 표시하지 않는다. 잘못된 JSON/schema는 실행 오류이며 자동 JSON repair 호출도 하지 않는다.

CLI는 제한된 작업 자료에서 선언적 결과를 반환한다. 임의 host shell/다른 사용자 파일/원본 Drive write/delete/외부 전송을 모델 도구에 제공하지 않는다. 파일 연산은 검증된 worker 도구로 수행한다. 지원하지 않는 임의 업무는 사용자에게 한계를 설명하고 코드 실행으로 우회하지 않는다.

## 인증과 외부 전송

Google OIDC openid/email/profile과 별도 Drive drive.file offline consent. Google Picker에서 선택한 파일만 서버 권한 확인 후 활성 grant 목록에 등록한다. Picker의 선택 UI와 앱의 허용 목록 검색은 구분한다. drive.file이 쓰기도 허용하더라도 원본 write/delete API는 노출하지 않는다.

초대는 관리자의 이메일 allowlist. 초기 관리자 verified Google 이메일은 운영 설정. OIDC issuer/audience/nonce/state/verified_email 검증, 식별은 Google subject. 초대는 최초 로그인 시 subject에 묶고 revoke 즉시 세션·작업·다운로드 차단. 후속 변경 send-invitation-emails에 따라 새 초대 생성 시 안내 메일을 한 번 시도하고, 기존 초대는 관리자 수동 발송으로 처리한다. 초대 권한과 SMTP 발송 상태는 분리한다.

OAuth/SMTP secret은 AES-256-GCM으로 DB 암호화, master/session keys는 Docker secret. HttpOnly/Secure/SameSite cookie 및 CSRF/Origin 검사. 모든 API/SSE/download/worker에서 owner를 검사한다. 사용자 입력 owner_id·절대 파일 경로를 신뢰하지 않는다. 관리자 기본 화면도 타 사용자 문서 본문을 열람하지 않는다.

CLI 소유자 로그인은 별도 보호된 영속 volume. 호스트 홈 전체·다른 사용자 자료·Docker socket mount 금지. auth를 모델 입력/도구에 노출하지 않도록 OS/CLI 도구 경계 검증을 수용 조건으로 둔다. 계정 로그인 성공만으로 격리 성공을 주장하지 않는다. 보장 불가면 기능 차단 및 근거 보고, API 과금/무제한 권한으로 우회 금지. argv spawn 사용, 사용자 문자열 shell 보간 금지.

결과물 외부 업로드/공유/첨부 전송은 artifact hash·대상·행위를 명시한 1회 승인. 산출물/대상 변경 시 승인 무효. 기존 정기 보고/오류 알림은 작업 설정으로 승인한 범위에서 수행한다.

## 파일·자료 처리

입력: xlsx/xls, pptx/ppt, text/scanned PDF, png/jpeg/webp, csv/tsv, 허용된 Google Sheets/Slides/Docs export. 출력: xlsx/pptx/pdf/csv/tsv/png/jpeg. legacy Office는 격리된 LibreOffice로 변환, PDF 렌더·추출/OCR은 로컬 라이브러리와 Tesseract kor/eng, 이미지 변환은 로컬 처리. 구체 parser library는 유지보수/라이선스/fixture 검사를 통과한 최신 안정판으로 선택·기록한다. LLM API OCR/유료 변환 서비스 금지.

Excel은 값/표시값/수식/계산값을 구분하고 수식 재계산은 복사본에서만 수행한다. macro 실행 금지, 외부 link/network formula 자동 갱신 금지. chart의 series/labels/units 및 렌더 이미지를 보존하고 추정은 uncertainty로 표시한다. 선택 시트/병합 헤더/날짜열/복수 deadline이 모호하면 task 설정에서 확인한다. 숨김 행·슬라이드·notes의 포함 여부도 계획에 명시한다.

원본 헤더·컬럼 순서·행 source ID를 유지한다. malformed date/encoding은 묵시 변환하지 않는다. CSV는 UTF-8 기본, BOM/CP949 선택 지원, leading zero/quoted newline 보존. 다운로드의 formula injection 방어 변환은 데이터 변경임을 사용자에게 표시한다. export 한계나 파일 손상을 부분 성공으로 숨기지 않는다.

출력은 원본 복사본/새 파일이며 byte hash가 불변인 원본은 수정하지 않는다. 생성 파일을 다시 열어 구조/수치 검증하고 PDF/PPT는 렌더 시각 QA를 한다. 근거는 파일 버전·hash·확보시각과 cell/page/slide/region을 연결한다. Drive 최신 링크가 분석 당시 byte와 다를 수 있음을 표시한다.

## 결정 출처

초대/공유 구독/허용 파일/원본 보존/재검토/알림/보관/기술 스택/컨테이너는 사용자 확정이다. npm/Drizzle/pg-boss, 완료 경계, lane·timeout·보안 기본값은 이번 명세 마무리 위임에 따른 설계 선택이며 과거 사용자 발언으로 소급하지 않는다. 변경은 OpenSpec change로 추적한다.
