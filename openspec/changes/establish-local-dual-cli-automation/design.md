# 구현 설계 인덱스

상태: 명세 인수인계본. 사용자 요청으로 Codex가 명세를 마무리하고 제품 코드는 Claude가 구현한다. 기존 PostgreSQL/Node tools Compose 기반만 구현·검증됐다. 이전 미정 목록은 아래 계약으로 해소했다. 실제 계정값·로그인은 운영자 설정이며 미완성 제품 정책이 아니다.

## 현행 문서

- proposal.md 및 specs/*/spec.md: 제품 요구·수용 시나리오.
- implementation-contract.md: 확정 아키텍처, 상태·완료 경계, npm/Drizzle/pg-boss, 큐·순환·취소/timeout, 일정, 비교, CLI 격리 및 파일 처리.
- contracts.md: 구조화 TaskPlan/manifest/analysis/comparison, API, 오류, 논리 DB 모델, 보관/경로.
- operations.md: Compose target, secrets/config, Google/CLI 인증, SMTP/푸시, 초기 운영/복구/Linux 이전.
- ui-spec.md: 화면·디자인 토큰·반응형·접근성·브라우저 검증.
- acceptance.md: A01–A32 및 형식 fixture·실제/모의 검증 구분.
- tasks.md: 단계별 구현 체크리스트.
- CLAUDE_HANDOFF.md: 대화 없이 읽을 구현 지시문과 현재 상태.

## 일관성 원칙

업무·일정·선택 파일은 사용자 TaskPlan으로 정한다. 연구 예시를 고정 workflow로 구현하지 않는다. 원본 불변, 같은 snapshot으로 독립 실행/검토, 사용자별 성공 교대, 오류 자동 retry 금지, 초대·사용자 격리·no-LLM-API·Compose를 유지한다.

사용자 직접 결정과 위임받아 선택한 설계 기본값의 구분은 implementation-contract.md 끝에 기록한다. 계정/정책/CLI 호환성을 아직 검증하지 않았으므로 이를 확정 성공으로 표현하지 않는다. 요구와 실제 기술 제약이 충돌하면 근거와 구체적 대안을 사용자에게 확인하며 유료/광범위 권한 fallback을 하지 않는다.

## 구조

Browser -> ngrok(optional) -> SvelteKit web -> PostgreSQL + queue -> local worker -> captured source/parsers -> Claude + Codex -> checks/comparison/artifacts -> result/evidence + notification outbox.

별도 migrate가 schema를 적용한다. DB/파일/auth는 컨테이너 수명과 분리하며 web에 Docker socket 접근을 주지 않는다. 외부 전송은 승인된 artifact/action/destination만 사용한다. 세부 검증은 acceptance.md를 따른다.
