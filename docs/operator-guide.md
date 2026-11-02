# 운영자 가이드

모든 명령은 프로젝트 루트에서 실행한다. Windows는 Docker Desktop(Linux 컨테이너), Linux는 Docker Engine + Compose v2. 호스트 Node/PostgreSQL 설치는 필요 없다.

## 1. 최초 준비

1. 비밀값 파일 생성(기존 값은 덮어쓰지 않음):
   - Windows: `powershell -File scripts/init-secrets.ps1`
   - Linux: `sh scripts/init-secrets.sh`
   - 자동 생성: `postgres_password`, `app_master_key`(32바이트, **반드시 백업**), `session_secret`, `runner_token`.
   - 빈 파일로 생성되는 선택 값: `google_client_secret`, `google_picker_api_key`, `smtp_password`, `vapid_private_key`, `ngrok_authtoken`. 해당 값을 파일에 직접 넣는다(채팅·로그·Git에 붙여넣지 않는다).
2. `.env.example`을 `.env`로 복사해 `PUBLIC_ORIGIN`, `BOOTSTRAP_ADMIN_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_PICKER_APP_ID` 등을 채운다.
3. 실행: `docker compose up -d --build --wait` (db → migrate(1회) → cli-runner → web/worker 순서, healthcheck 대기).
4. 상태: `docker compose ps`, `curl -s localhost:3000/health/ready`.

## 2. 소유자 CLI 구독 로그인 (API 키 사용 금지)

인증은 `cli-auth-claude`, `cli-auth-codex` named volume에만 저장되며 이미지/Git에 포함되지 않는다. web·worker에는 마운트되지 않는다.

- Codex(ChatGPT Plus): `docker compose run --rm cli-runner codex login --device-auth` → 표시된 URL에서 로그인 후 코드 입력(15분 만료).
- Claude(Pro): `docker compose run --rm cli-runner claude auth login --claudeai` → 표시된 URL에서 로그인 후 받은 코드를 터미널에 붙여넣기.
- 확인: `docker compose run --rm cli-runner sh -c 'claude auth status --text; codex login status'`. 관리자 화면 → 실행 환경 상태에도 표시된다(최대 60초 지연).
- `ANTHROPIC_API_KEY`·`OPENAI_API_KEY` 등이 cli-runner 환경에 있으면 실행을 거부한다.
- 실제 구독 검증(사용량 소모): `docker compose run --rm -e LIVE_CLI=1 -e TEST_DATABASE_NAME=yeeun_test_live test npx vitest run --project live`

## 3. Google OAuth / Picker

Google Cloud Console에서 OAuth 클라이언트(웹)를 만들고 승인된 리디렉션 URI에 `<PUBLIC_ORIGIN>/auth/google/callback`, `<PUBLIC_ORIGIN>/api/drive/callback`을 등록한다. 범위: `openid email profile`(로그인), `https://www.googleapis.com/auth/drive.file`(결과 복사본 업로드·선택기 허용), `https://www.googleapis.com/auth/drive.readonly`(자연어 Drive 검색·읽기). **Google 인증 플랫폼 → 데이터 액세스**에 세 범위를 추가하고, Google Drive API·Google Picker API를 사용 설정한다. OAuth 동의 화면이 "테스트" 상태면 Drive 토큰이 7일마다 만료되므로 **게시(프로덕션)**한다. drive.readonly는 제한된 범위라 미검증 상태에서는 동의 화면 경고와 최대 100명 제한이 있다. 범위를 바꾼 뒤에는 사용자가 앱에서 Drive를 다시 연결해야 한다. Picker API key는 웹사이트 제한을 `<PUBLIC_ORIGIN>/*` 형식으로 두고 API 제한에 Google Picker API를 포함한다. App ID(`GOOGLE_PICKER_APP_ID`)는 프로젝트 ID가 아니라 **숫자 프로젝트 번호**(OAuth 클라이언트 ID 앞부분)다. 도메인이 바뀌면 리디렉션 URI·referrer·Web Push 구독을 다시 확인한다.

## 4. 외부 접속(ngrok, 선택)

`.secrets/ngrok_authtoken`과 `.env`의 `NGROK_DOMAIN`(고정 도메인), `PUBLIC_ORIGIN=https://<NGROK_DOMAIN>`을 설정하고 `docker compose --profile ngrok up -d --wait`. ngrok은 web만 전달한다. 호스트 노출 포트는 기본 `127.0.0.1:3000`이다.

## 5. 메일·푸시

- 운영자 기본 발신: `.env`의 `SMTP_*` + `.secrets/smtp_password`. 사용자는 설정 화면에서 개인 SMTP 프로필을 만들 수 있고(실제 SMTP 인증 검사 후 사용 가능), 관리자는 공유 프로필을 만들 수 있다.
- Web Push: VAPID 키 생성 예 `docker compose run --rm tools npx --yes web-push@3.6.7 generate-vapid-keys` → 공개키는 `.env` `VAPID_PUBLIC_KEY`, 개인키는 `.secrets/vapid_private_key`, `VAPID_SUBJECT=mailto:운영자주소`.

## 6. 보관 경로

기본 호스트 `./file` → 컨테이너 `/data`. 경로 변경은 관리자 화면에서 요청하면 `pending_mount` 상태와 필요한 Compose 수정이 표시된다. 운영자가 compose.yaml의 volume을 수정하고 `docker compose up -d --wait`로 재생성한 뒤 화면에서 적용한다. 앱은 Docker를 제어하지 않는다. 기존 파일은 원래 루트 참조를 유지하며, 명시적 이전은 복사 → hash 검증 → DB 참조 갱신 순서이고 이전 파일 삭제는 운영자가 따로 확인한다.

PC에서 첨부한 파일(홈의 + 버튼·끌어다 놓기·Ctrl+V)은 `users/<uuid>/originals/`에 업무 원본으로 보관된다. 실행 후 정리(raw 스냅샷 삭제) 대상이 아니며 사용자가 첨부를 빼거나 삭제할 때만 지워진다. zip은 업로드 때 풀어 파일별로 저장한다. 파일당 한도는 `MAX_SOURCE_FILE_BYTES`(web의 `BODY_SIZE_LIMIT`도 이 값), zip을 푼 총량 한도는 `MAX_RUN_SOURCE_BYTES`, 한 요청 최대 10개. web 컨테이너가 이 폴더를 쓰므로 호스트 폴더는 uid 1000(node)이 쓸 수 있어야 한다.

## 7. 업그레이드·백업·복구(Linux 이전)

- 백업: `scripts/backup.sh <보호된_백업_경로>` — worker를 멈추고 pg_dump, `file/` tar, `.secrets`, CLI 인증 volume을 묶어 SHA256SUMS와 행 개수(COUNTS)를 기록한 뒤 worker를 다시 시작한다. **백업에는 비밀값과 로그인 토큰이 들어 있다.** OneDrive 등 동기화 폴더가 아닌 암호화된 위치에 둔다. (프로젝트가 OneDrive 안에 있으면 `.secrets`도 동기화될 수 있으니 주의.)
- 복구(새 Linux 호스트): 저장소를 받은 뒤 `scripts/restore.sh <백업경로>` — hash 검증, `.secrets` 복원(다른 값이 있으면 중단), `file/` 복원, 인증 volume 복원, DB 복원 후 행 개수·보관 파일 hash 대조, 앱 시작. 기존 DB volume이 있으면 거부한다.
- 같은 occurrence는 고유키로 한 번만 실행되며, 중단 기간의 누락 예약은 작업별 1회로 병합된다.
- `docker compose down`은 volume을 보존한다. `down -v`는 DB·로그인 volume을 지우는 파괴적 명령이므로 업그레이드 절차에 쓰지 않는다.

## 8. 테스트 명령

- 유닛: `docker compose run --rm test npx vitest run --project unit`
- 통합(별도 DB `yeeun_test*` 재생성): `docker compose run --rm -e TEST_DATABASE_NAME=yeeun_test_core test npx vitest run --project integration`
- 타입: `docker compose run --rm tools sh -c "npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json"`
- E2E/접근성: `docker compose --profile e2e run --rm e2e npx playwright test`
- 라이브 CLI(구독 사용량 소모): 2절 참조.


## 초대 안내 메일

관리 화면의 **초대하고 메일 보내기**는 로그인 허용 목록 등록 후 관리자에게 허용된 발신 프로필(없으면 운영자 기본 SMTP)로 안내 메일을 1회 보냅니다. 메일 발송 실패와 초대 권한은 별개이며 실패해도 초대된 Google 계정은 로그인할 수 있습니다.

기존 초대는 자동 발송하지 않습니다. 가입 전인 기존 초대 행의 **메일 보내기/메일 다시 보내기**를 누르고 수신 대상을 확인하세요. 상태는 미발송/발송 중·완료 미확인/SMTP 접수 완료/발송 실패로 표시됩니다. SMTP 접수 완료는 수신함 도착 보장이 아닙니다. 실패 자동 재시도는 없고 취소·가입 완료된 초대에는 보내지 않습니다.

발송 중 프로세스가 중단되면 실제 접수 여부가 불확실할 수 있습니다. 5분 후 관리 화면을 새로고침하면 명시적으로 다시 보낼 수 있으나 같은 메일이 중복 도착할 수 있습니다. SMTP 587은 SMTP_SECURE=false와 STARTTLS 필수 설정을 사용합니다.
