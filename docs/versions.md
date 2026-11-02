# 버전 기록 (tasks 2.1)

확인일: 2026-11-02. 모든 버전은 Compose `tools` 컨테이너에서 `npm view`로 조회한 공식 최신 정식(stable) 릴리스 중 peer/engine 호환 조합이다. beta/RC/nightly는 사용하지 않았고 `package-lock.json`으로 고정한다(`npm ci`).

## 베이스 이미지 (digest 고정)

| 이미지 | 버전 | digest |
|---|---|---|
| node | 26.13.0-bookworm-slim | `sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9` |
| postgres | 18.6 | `sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81` |
| ngrok/ngrok (선택 profile) | 3.39.13 (`ngrok version`) | `sha256:ff3b5c3674432d14a786349908b7bdf28ee56c25662637afcbe7180d471993ef` |
| cloudflare/cloudflared (cloudflare profile) | 2026.10.7 (`cloudflared --version`, 2026-11-03 확인) | `sha256:4955524aeaa379e154023d5a027c250f7b35041a2e7e950cf13f144bc9b9c5ba` |
| mcr.microsoft.com/playwright (e2e profile) | v1.64.1-noble | @playwright/test 1.64.1과 일치 |

## 구독 CLI (cli-runner 이미지, npm 전역 설치, 정확한 버전 고정)

| CLI | 버전 | 비고 |
|---|---|---|
| @anthropic-ai/claude-code | 2.1.316 | `claude -p --output-format json --json-schema … --tools "" --safe-mode --strict-mcp-config --no-session-persistence --permission-prompts none`; `--bare`는 API key 인증만 허용하므로 사용 금지 |
| @openai/codex | 0.166.0 | `codex exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --output-schema … --disable <도구 기능>` |

플래그는 설치된 CLI의 `--help`로 확인했다(추정 아님). 실제 구독 응답 검증 결과는 `openspec/changes/establish-local-dual-cli-automation/tasks.md` 2.2 기록을 따른다.

## 워커 도구 (Debian bookworm 패키지, 이미지 빌드 시 `/etc/yeeun-tool-versions`에 기록)

| 패키지 | 버전 |
|---|---|
| tesseract-ocr | 5.3.0-2 |
| tesseract-ocr-kor / -eng | 1:4.1.0-2 |
| poppler-utils | 22.12.0-2+deb12u3 |
| libreoffice-core-nogui / calc / impress / writer | 4:7.4.7-1+deb12u14 (LibreOffice 7.4.7.2) |
| fonts-noto-cjk | 1:20220127+repack1-1 |

apt 패키지는 bookworm 저장소의 보안 업데이트로 재빌드 시 바뀔 수 있다. 재빌드 후 `/etc/yeeun-tool-versions`를 확인해 이 표와 다르면 갱신한다.

## npm 패키지 (exact, package.json)

| 범주 | 패키지 |
|---|---|
| 프레임워크 | @sveltejs/kit 3.1.1, @sveltejs/adapter-node 6.0.1, @sveltejs/vite-plugin-svelte 7.3.1, svelte 5.57.3, vite 8.3.5 |
| UI | tailwindcss 4.3.3, @tailwindcss/vite 4.3.3, bits-ui 2.20.3 (shadcn-svelte 기반 primitive), @lucide/svelte 1.66.0, tailwind-variants 4.0.1, tailwind-merge 3.7.0, clsx 2.1.1, tw-animate-css 1.4.0, @internationalized/date 3.12.4 |
| 데이터 | drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, pg-boss 12.38.0, zod 4.6.7 |
| 인증/연동 | openid-client 6.8.8, nodemailer 10.3.1, web-push 3.6.7 |
| 파일 | cfb 1.2.2 (HWP 5 컨테이너, Apache-2.0; hwp 5.0 정식 npm 파서가 없어 본문 레코드 해석은 자체 구현), exceljs 4.4.0, pptxgenjs 4.0.1, pdfjs-dist 6.5.438, jszip 3.10.2, fast-xml-parser 5.11.2, csv-parse 7.0.3, iconv-lite 0.7.3, sharp 0.35.5 (libvips 8.18.7) |
| 기타 | luxon 3.7.2, @opentelemetry/api 1.10.0 |
| 개발/검증 | typescript 6.0.3, svelte-check 4.7.8, vitest 5.0.5, @playwright/test 1.64.1, @axe-core/playwright 4.14.0, esbuild 0.28.2, tsx 4.23.15, prettier 3.9.10, prettier-plugin-svelte 4.1.1, @types/* (node 26.6.6, pg 8.23.1, luxon 3.7.6, nodemailer 8.0.2, web-push 3.6.4) |

### 호환성 결정

- **TypeScript 7.0.2(최신)는 사용하지 않음**: @sveltejs/kit 3.1.1의 peer가 `typescript ^6.0.0`, svelte-check 4.7.8의 peer가 `^5 || ^6`이다. 호환되는 최신 정식인 6.0.3을 고정했다.
- **SvelteKit 3**: 설정이 `vite.config.ts`의 `sveltekit({...})`로 이동했고 앱 import는 package `imports`의 `#lib/...`(확장자 명시)를 쓴다. `Handle` 타입은 `@sveltejs/kit/hooks`에서 가져온다.
- **pg-boss 12**: 모든 큐 `retryLimit: 0`. 사용자 lane(검토 대기 중 같은 사용자 대기)은 pg-boss 정책으로 표현할 수 없어, 실행 FIFO·lane·전역 동시성은 앱 `runs` 테이블 claim(advisory lock + `FOR UPDATE SKIP LOCKED`)이 권위 있는 큐다. pg-boss는 scheduler cron, 알림 전달, snapshot 정리, dispatch 깨우기에 쓴다.
- **npm 11 install-scripts 허용 목록**: esbuild postinstall만 `allowScripts`로 승인했다.
- **CLI 격리 구조**: 계약의 Compose 서비스 목록(db/migrate/web/worker/tools/ngrok)에 `cli-runner`를 추가했다. worker 안에서 CLI를 실행하면 모델 도구가 `/data`의 다른 사용자 파일과 DB 비밀번호에 닿을 수 있어, CLI 바이너리와 소유자 인증 volume만 있는 별도 컨테이너로 분리했다(web·db 네트워크와 분리, Docker socket 없음, read-only rootfs). 스택 변경이 아니라 격리 요구를 위한 배치 결정이다.
