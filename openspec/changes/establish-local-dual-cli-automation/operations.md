# 컨테이너·설정·운영 계약

## Compose target

db, one-shot migrate, web, worker, tools profile, 선택 ngrok profile. 기존 db/tools 기반을 확장한다. 완성 후 `docker compose up -d --build --wait`가 기본 실행 명령이어야 한다. web은 migration/DB 준비, worker는 schema/config 준비를 확인한다. CLI 로그인 미완료는 해당 capability unavailable로 표시하고 가짜 성공을 반환하지 않는다.

Linux image, non-root web/worker, init, graceful shutdown, healthcheck. privileged·Docker socket·host 홈 전체 mount 금지. web 호스트 노출은 loopback 기본, ngrok은 web만 forward. PostgreSQL은 내부 network. 임의 명령 실행 HTTP API를 만들지 않는다. CLI/파일 도구 network는 설정된 서비스 endpoint로 제한하며 사용자 자료의 URL/명령을 자동 실행하지 않는다.

DB named volume, file host bind, owner CLI auth 별도 protected named volumes. credential을 image에 bake하지 않는다. 문서화된 일회성 Compose 명령으로 지원된 device/browser login 수행. auth refresh/계정 일치/컨테이너 recreate 후 지속을 실제 검사한다. 웹 사용자의 Google 로그인과 소유자 CLI 로그인은 별개다. LLM API 전환은 추후 별도 change.

ngrok profile은 운영자가 제공한 token과 stable domain 사용. PUBLIC_ORIGIN/Google callback URI는 실제 HTTPS origin과 일치시킨다. proxy header는 신뢰된 경로에서만 수용한다. 도메인 변경 시 origin에 묶인 OAuth/푸시를 재검증하고 묵시 성공 처리하지 않는다.

## 환경 설정

| 설정 | 기본 또는 제공 주체 |
|---|---|
| PUBLIC_ORIGIN | 운영자 실제 ngrok HTTPS URL |
| BOOTSTRAP_ADMIN_EMAIL | 운영자 verified Google 이메일 |
| GOOGLE_CLIENT_ID/SECRET | 운영자 Google OAuth project |
| GOOGLE_PICKER_API_KEY/APP_ID | 운영자 project, key origin/API 제한 |
| DATABASE_URL 또는 component secrets | 내부 DB, secret password |
| APP_MASTER_KEY_FILE | 운영자 생성 32-byte master key, 백업 필수 |
| SESSION_SECRET_FILE | 운영자 생성 session key |
| FILE_STORAGE_HOST_PATH | `./file` |
| FILE_STORAGE_ROOT | `/data` |
| TASK_CONCURRENCY | 1, 지원 범위 1–8, 사용자 lane은 1 |
| CLI_STAGE_TIMEOUT_SECONDS | 1800, 관리자 60–7200 |
| TASK_TIMEOUT_SECONDS | 5400, stage보다 작지 않게 검증 |
| WORKER_HEARTBEAT_SECONDS/LEASE_SECONDS | 15/60 |
| MAX_SOURCE_FILE_BYTES | 100 MiB/file, 관리자 조정 |
| MAX_RUN_SOURCE_BYTES | 500 MiB/run, 관리자 조정 |
| MAX_OCR_PAGES | 300/run, 초과 시 선택/설정 변경, silent truncate 금지 |
| SMTP endpoint/TLS/profile | 기존 운영자/사용자 계정 |
| VAPID_PUBLIC_KEY/PRIVATE_KEY_FILE/SUBJECT | 운영자 생성 키 및 연락 URI |
| NGROK_AUTHTOKEN_FILE/DOMAIN | 운영자, optional external profile |
| CLI auth volume locations | 고정 container 경로, 구독 계정 로그인 |

비밀값은 실 `.env`/Docker secret 및 encrypted DB. `.env.example`에는 이름/설명만, Git/build context에 auth/file/backup 포함 금지. 기존 secret UI 재표시 금지. 일반 사용자는 허용된 sender profile 선택 또는 자기 SMTP 인증 프로필을 암호화 저장할 수 있다. from 문자열 변경만으로 발신 권한을 얻지 못한다. 임의 외부 경로는 관리자만 설정한다.

## 메일·푸시

Nodemailer SMTP/TLS를 사용하며 password/app-password 및 provider가 지원하는 OAuth profile을 처리한다. Drive 동의가 SMTP 권한을 주는 것은 아니다. sender credential/verified from을 검사하고 새 수신 이메일은 challenge 검증 전 사용하지 않는다. 최초 로그인 verified 이메일은 수신처 제안으로 제공한다. 유료 메일 서비스를 자동 추가하지 않는다.

메일/푸시 독립 선택. 푸시는 user gesture로 permission, service worker + VAPID, device subscription별 보관. denied/unsupported는 상태·안내 표시, 사용자가 끈 메일을 자동 켜지 않는다. 이미 선택한 메일은 독립적으로 계속 시도한다. push endpoint 404/410이면 만료 표시 및 비활성화.

이벤트와 notification outbox commit 후 연결 가능 시 통상 10초 이내 전송 시도한다. 성공은 SMTP/push service 접수이며 사람의 열람을 뜻하지 않는다. 채널별 한 번 시도하며 실패는 웹에 표시하고 수동 재전송 제공. 모델 재실행/재귀 오류메일/무한 retry 금지. 한 채널 실패에도 다른 선택 채널은 시도한다. 인증 token의 사전 정상 refresh는 작업 재실행과 구분한다. PC/네트워크가 꺼진 동안 즉시 수신을 보장하지 않는다.

정상 0건·변경 없는 결과도 요청 주기 알림. 해당 task mute는 정상 email/push만 한국시간 자정까지 억제하고 오류는 예외다. push에는 최소 제목/상태와 인증된 결과 링크만. 상세 보고 메일 범위는 task 확인에 표시하고 새로운 recipient/첨부 전송은 외부 동작 승인 범위로 처리한다. 민감 token이나 로컬 path는 보내지 않는다.

## 오류와 복구

실행 오류는 즉시 상태 저장·선택 채널 통지·해당 run 중단, 자동 retry 없음. 알림 자체가 실패하면 delivery_failed를 UI에 남기고 다른 선택 채널만 시도한다. DB outage 시 안전한 로컬 journal/가용 결과를 보존하고 복구 때 상태를 reconcile하되 모델을 rerun하지 않는다. 로그에 raw source/password/token 기록 금지.

upgrade 전 worker claims/scheduler를 정지하고 pg_dump + file root + master/session secrets + auth volume을 보호된 위치에 일관되게 백업한다. Linux에서 같은 fixed image로 복원, root mapping·hash·권한·auth·스케줄 watermark를 검증하고 resume한다. catch-up 중복 없어야 한다. `down`은 volume 유지, `down -v`는 파괴적 작업이며 정상 upgrade 절차에 넣지 않는다.

## 운영자 입력과 구현 검증의 경계

Google/SMTP/ngrok 실제 값, master/session/VAPID 키 생성, CLI 브라우저 로그인은 운영자 입력이다. 질문 없이 가짜 값으로 실제 연동 완료를 주장하지 않는다. 컨테이너 구독 인증/CLI tool 제한/legacy format/모바일 푸시는 실제 수용 검사 대상이다. no-LLM-API 조건에서 불가능하면 capability를 차단하고 근거를 보고한다. 유료/다른 계정/격리 완화로 우회하지 않는다.

## 기술 근거

- Drizzle PostgreSQL/migrations: https://orm.drizzle.team/docs/get-started/postgresql-new
- PostgreSQL queue/retry: https://pgboss.io/api/queues
- SMTP transport: https://nodemailer.com/smtp
- Google Picker: https://developers.google.com/workspace/drive/picker/guides/overview
- Drive scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Codex auth: https://learn.chatgpt.com/docs/auth
- Claude containers: https://code.claude.com/docs/en/devcontainer
- Docker mounts: https://docs.docker.com/engine/storage/bind-mounts/
- Web Push/iOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

이 자료는 설계 선택의 근거이며 실제 최신 라이브러리/CLI 계약은 구현 버전으로 재확인한다.
