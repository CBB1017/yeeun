# 로컬 이중 CLI 업무 자동화

초대된 Google 사용자가 자연어로 요청한 업무를, 사용자가 명시적으로 허용한 Google Drive 파일에 대해 소유자의 **Claude Code(Claude Pro)** 와 **Codex(ChatGPT Plus)** 구독 CLI로 각각 독립 실행하고, 코드 검산과 결과 대조를 거쳐 답변·다운로드·근거를 제공한다. LLM API·유료 fallback은 쓰지 않는다. 연구 과제 마감 분석은 예시 업무일 뿐 고정 workflow가 아니다.

구현 상태와 검증 수준(실제/모의 구분)은 `openspec/changes/establish-local-dual-cli-automation/tasks.md`와 `docs/acceptance-evidence.md`가 기준이다. 요약:

- 실제 검증됨: Compose 빌드·기동·재생성 후 데이터/로그인 유지, 컨테이너 안 Claude/Codex 구독 로그인과 실제 독립 실행 → 검산 → 대조 → 완료, CLI 도구 격리(주입·직접 명령 실행 불가), 백업→복원 리허설(같은 Docker Desktop 호스트).
- 자동 테스트(모의 포함)로만 검증: Google 로그인/Drive/Picker 흐름, 메일·푸시 전달, 외부 Drive 복사 업로드.
- 미검증: 실제 Google OAuth·Picker·SMTP·Web Push·ngrok(운영자 자격 증명 필요), 실제 기기 브라우저 QA, 별도 Linux 호스트 이전, 디스크 가득참/DB 중단 주입.

## 구성

SvelteKit 3 + Svelte 5 + Tailwind CSS 4 + bits-ui(shadcn-svelte) / PostgreSQL 18 + Drizzle + pg-boss / Node 26. Compose 서비스:

| 서비스 | 역할 |
|---|---|
| db | PostgreSQL (internal 네트워크만) |
| migrate | 일회성 schema 적용(Drizzle SQL + pg-boss) |
| web | 화면/API/SSE (`127.0.0.1:3000`) |
| worker | 스케줄·큐·Drive 캡처·파서/OCR/LibreOffice·검산·산출물·알림 |
| cli-runner | Claude/Codex CLI와 소유자 로그인 volume만 보유. 사용자 파일·DB 접근 없음, 모델 도구 비활성 |
| tools / test / e2e / ngrok | 개발 명령 / 테스트 / 브라우저 E2E / 선택적 외부 공개(profile) |

## 시작

```sh
sh scripts/init-secrets.sh            # Windows: powershell -File scripts/init-secrets.ps1
cp .env.example .env                  # 값 채우기 (비밀값은 .secrets/ 파일에)
docker compose up -d --build --wait
docker compose run --rm cli-runner codex login --device-auth
docker compose run --rm cli-runner claude auth login --claudeai
```

자세한 운영(Google OAuth/Picker 설정, 메일·푸시, 보관 경로 변경, 백업·복구, 테스트 명령)은 `docs/operator-guide.md`. 버전과 호환성 결정은 `docs/versions.md`.

## 보관

호스트 `./file`(설정 가능) → 컨테이너 `/data`. 원본 Drive 파일은 수정·삭제하지 않는다. 정상 완료 후에는 원본 스냅샷만 삭제하고 결과·다운로드·근거·버전 정보는 계속 보관한다. 오류·검토 중에는 원본과 부분 결과를 DB와 별도 로컬 복사본으로 유지한다.

`docker compose down`은 volume을 보존한다. `down -v`는 DB와 CLI 로그인을 지우므로 사용하지 않는다. `.secrets/`, `file/`, 백업은 Git에서 제외되며, 이 폴더가 OneDrive 등 동기화 폴더 안에 있으면 비밀값이 클라우드로 동기화될 수 있으니 주의한다.
