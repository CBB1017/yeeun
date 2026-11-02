# Local dual-CLI workflow automation

## Why

초대 사용자가 자연어로 요청한 업무를 소유자의 Claude Code와 Codex에서 독립 수행하고, 원본 근거·코드 검산 및 결과 대조로 오류를 줄인 뒤 답변과 다운로드를 제공한다. 범용 업무·예약을 지원하며 연구 과제 마감 분석은 한 가지 예시다.

## What Changes

- 관리자 초대 Google OIDC 로그인, 사용자별 OAuth 및 명시적으로 허용한 Drive 파일만 참조.
- Excel/PowerPoint/PDF/이미지/CSV/TSV 파싱, 스캔 OCR·수식·차트 해석, 원본 위치·버전 근거.
- 같은 원본·계획으로 두 CLI 각각 1회 독립 실행. 사용자별 지정 담당이 대조·정리하며 최초 Claude, 성공 완료마다 교대.
- 첫 불일치는 사용자에게 표시. 요청한 재검토는 최초 원본과 불일치 사실만으로 각각 다시 수행. 2차도 다르면 오류 메일·푸시.
- 핵심 사실·수치·대상·근거가 같으면 표현 차이 허용. 수치/검산 실패는 정리 중단. 실행 오류는 즉시 알리고 자동 retry 없이 중단.
- 자연어 작업 설정·파일 후보 선택·사용자 일정, 최초 선택 파일의 최신 내용 조회, PC 중단 누락 작업별 1회 실행.
- 원본 수정·삭제 금지. 복사본 가공·다운로드, 외부 전송은 확인 후 수행.
- 정상 결과·다운로드·버전·근거 정보 계속 보관. 오류/검토 최초 원본·부분 결과 유지. 정상 최종 응답 완료 후 raw snapshot만 삭제.
- 보관 루트 설정 가능, 기본 프로젝트 file/, 별도 로컬 복사본 및 DB 경로.
- 메일·브라우저 푸시 개별 선택 및 발신/수신 설정. 해당 작업 정상 알림 당일 숨김, 오류 예외, 한국시간 자정 해제.
- SvelteKit/shadcn-svelte/Tailwind CSS/PostgreSQL 최신 안정 호환 조합, 별도 worker, Compose 기본 실행과 Linux 이전.

## Capabilities

### New Capabilities

- `prompt-submission`: 자연어 계획 확인과 모호성 해소.
- `drive-file-reference`: 초대/OIDC/선택 파일 및 버전·근거.
- `dual-cli-execution`: 구독 인증·독립 실행·구조화 응답·격리.
- `result-comparison`: 검산·대조·재검토·라운드로빈.
- `scheduled-tasks`: 범용 예약·누락 1회 실행.
- `research-deadline-report`: 사용자 예시 업무의 수용 시나리오.
- `notifications`: SMTP/Web Push·오류·당일 숨김.
- `output-artifacts`: 복사본·다운로드·외부 전송 확인.
- `execution-queue`: 태스크 대기열·취소·오류 중단.
- `data-retention`: snapshot 수명·결과와 근거 보존.
- `container-runtime`: Compose·영속 인증·Linux 이전.
- `responsive-workspace`: 반응형 웹·접근성·화면 흐름.

### Modified Capabilities

없음. 신규 제품이며 DB/tools Compose 기반 외 제품 코드는 아직 없다.

## Impact

초대 사용자는 소유자의 Claude Pro/ChatGPT Plus 사용량을 공유한다. LLM API·유료 fallback·네이티브 앱·원본 수정은 범위 밖이다. 별도 유료 인프라를 요구하지 않되 기존 구독/SMTP/OAuth 한도는 운영 계정으로 검증한다. 무료 무제한·완전한 오류 제거를 보장하지 않는다.

## Handoff Status

2026-11-02 사용자는 구현 전 명세 마무리를 Codex에 위임하고 코드 구현은 Claude에게 맡긴다고 지정했다. 현행 계약은 specs 및 design.md가 연결하는 implementation-contract/contracts/operations/ui-spec/acceptance/tasks다. decisions*.md는 역사이며 이 계약을 덮어쓰지 않는다. 제품 구현 완료나 실계정 연동 완료를 의미하지 않는다. Claude 구현 시작 안내는 CLAUDE_HANDOFF.md를 따른다.
