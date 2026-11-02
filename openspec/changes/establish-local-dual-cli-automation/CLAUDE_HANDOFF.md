# Claude 구현 인수인계

## 사용자 지시

사용자는 코드 구현을 Claude에게 맡기고 Codex에게 구현 전 명세 마무리를 위임했다. 제품 코드는 아직 없다. 기존 Compose db/tools 실행 기반만 구현·검증됐다. 이 문서와 연결 문서는 이전 대화 없이 구현할 수 있는 현행 계약이다.

## 읽는 순서

1. proposal.md 및 specs/*/spec.md — 제품 요구.
2. design.md 및 implementation-contract.md — 구조/상태/구현 결정.
3. contracts.md — 데이터/API/CLI/보관.
4. operations.md 및 ui-spec.md — 배포/운영/화면.
5. acceptance.md 및 tasks.md — 인수 기준/순서.

decisions.md와 decisions-2026-11-02.md는 역사이며 현행 계약을 덮어쓰지 않는다. 제품을 고정 연구 분석·고정 일정으로 축소하거나 원본 수정/광범위 Drive 권한/LLM API를 추가하지 않는다.

## 붙여넣을 구현 지시문

> OpenSpec change `establish-local-dual-cli-automation`의 proposal/specs/design과 연결 문서를 읽고 tasks를 구현해줘. 먼저 적용되는 AGENTS.md/CLAUDE.md, git diff, 기존 Compose 상태를 확인해. SvelteKit + shadcn-svelte + Tailwind CSS + PostgreSQL, TypeScript/npm/Drizzle/pg-boss, 별도 worker와 Docker Compose를 사용해. 컨테이너 CLI 구독 로그인·독립 실행·도구 격리부터 실제 검증하고, fixture 성공으로 live 연동을 대신하지 마. API 과금이나 다른 계정으로 우회하지 말고 비밀값은 운영 설정으로만 받아. 각 작업 완료와 검증을 기록하고, 중요한 요구와 기술 제약이 충돌하면 근거와 구체적 대안을 확인해. 모든 핵심 수용 기준을 충족하기 전에 전체 구현 완료로 보고하지 마.

## 현재 확인된 상태

- PostgreSQL Compose healthy 및 실제 SQL 접속, 서버 18.6.
- Node tools 26.13.0 및 container `/data` -> host `file/` 생성 파일 보존.
- 공식 base image digest 고정, local secret Git 제외.
- 이전 단계 OpenSpec strict 통과. 이번 확장 인수인계 명세도 공식 CLI strict 검증을 통과했다. 검증 기록은 validation.md를 확인한다.

## 아직 제품에서 검증하지 않은 것

web/worker/migrate 서비스, CLI Linux 설치/로그인/구독 호출/도구 격리, Google 실제 OAuth/Picker, parser/다운로드, SMTP/push, 브라우저·Linux 복원. 이 항목을 working이라고 보고하지 않는다.

## 운영자 입력

실제 Google OAuth/Picker 프로젝트 값, 초기 관리자 이메일, ngrok 도메인/token, SMTP 계정, master/session/VAPID 키 생성 및 CLI browser/device 로그인은 운영자가 제공한다. token/password를 대화·로그·Git에 출력하지 않는다. 연구 파일은 사용자 Picker 선택 대상이며 고정 URL을 개발 전에 요구할 필요가 없다.

## 인수 조건

명세상 기술 기본값은 이번 위임으로 선택됐으므로 같은 제품 정책을 반복 질문할 필요는 없다. 실제 호환 불가/서비스 정책 제한/격리 불가를 발견하면 조용히 요구를 완화하지 말고 차단 원인을 보고한다. 제품 코드 변경·DB migration·외부 실제 전송은 사용자가 Claude에게 넘긴 구현 범위와 실행 권한을 따른다.
