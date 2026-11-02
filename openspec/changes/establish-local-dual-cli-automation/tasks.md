## 1. Existing foundation and specification handoff

- [x] 1.1 Compose PostgreSQL persistent volume, healthcheck and local secret; live SQL verification.
- [x] 1.2 Linux Node tools and host file binding; runtime and file-persistence verification.
- [x] 1.3 Pin verified base-image versions/digests; document safe startup and retained volumes.
- [x] 1.4 Consolidate canonical requirements, implementation decisions, contracts, UI, operations, acceptance and Claude handoff without adding product code.
- [x] 1.5 Validate the completed handoff with official OpenSpec strict mode and record result.

## 2. Verify runtime feasibility before product features

- [x] 2.1 Read applicable project instructions/diff and resolve latest compatible stable versions. Record exact packages, engines, CLI versions and image digests in docs/versions.md; commit npm lockfile. Validate dependency/engine installation in Compose.
- [x] 2.2 Install and authenticate Claude/Codex in Linux worker containers using owner subscriptions; verify each returns a real schema-valid response without API billing credentials and auth persists across recreation. Acceptance A09/A29.
- [x] 2.3 Verify fresh-session and tool/OS isolation boundaries against malicious source instructions and cross-user file reads. Block unsupported capability instead of falling back. A02/A30.
- [x] 2.4 Create actual web/worker/migrate services, readiness and graceful shutdown. Verify default Compose build/up/recreate and keep db internal. A28.

## 3. Persistent identity and configuration

- [x] 3.1 Implement Drizzle migrations, database constraints/indexes, transaction/outbox boundaries and encryption key bootstrap. Test migrate against fresh and existing database.
- [x] 3.2 Implement administrator bootstrap, invitations/revoke, Google OIDC/session/CSRF and owner-scoped API/download/SSE access. A01/A02/A04.
- [ ] 3.3 Implement separate Drive OAuth drive.file/Picker, verified grants, grant-only search, ambiguity selection and disconnect. Test real consent plus A03/A04/A08.
- [x] 3.4 Implement settings, encrypted credential profiles, storage roots and safe pending-mount/migration behavior. A27.

## 4. User-defined tasks and scheduling

- [x] 4.1 Implement reviewable natural-language task plans and targeted clarification, output selection, explicit timezone/schedule confirmation and authoring-call disclosure. A05/A06.
- [x] 4.2 Implement pg-boss queue with no task retries, persistent claims, FIFO, global default 1/user lane 1 and future configurable global concurrency. A16/A32.
- [x] 4.3 Implement schedule revision/occurrence idempotency, same selected file identity, missed-run coalescing and interrupted active-run handling. A08/A17.
- [x] 4.4 Implement cancel/lease/heartbeat/timeout, sibling termination, partial retention and explicit manual rerun. A14/A32.

## 5. Sources and generated artifacts

- [x] 5.1 Capture immutable bytes/version manifest and provide identical inputs; retain source through disagreement/error. Test mid-capture source changes and round-2 source identity. A08/A09/A12/A25.
- [x] 5.2 Implement local file parsers/OCR/formula/chart extraction, source-position evidence and size/format limits; complete acceptance format fixtures without silent truncation.
- [x] 5.3 Implement deterministic typed-value/date/record/evidence checks. Verify the 30-inclusive-date research example only when requested. A07/A11.
- [x] 5.4 Generate and reopen/validate xlsx/pptx/pdf/csv/tsv/png/jpeg copies; render PDF/PPT for visual QA and prove original hash unchanged. A18.
- [x] 5.5 Implement external action hash/destination approval and single-use idempotency including new Drive copy uploads. A19.

## 6. Dual execution and result lifecycle

- [x] 6.1 Implement independent initial CLI calls, fresh sessions, strict schema validation and safe execution metadata. A09/A14.
- [x] 6.2 Implement assigned reviewer comparison/finalization with code checks authoritative, both-result UI and exact disagreement feedback boundary. A10/A11/A12/A13.
- [x] 6.3 Implement per-user initial Claude/next Codex and transactional exactly-once success advance. A15/A16/A32.
- [x] 6.4 Implement completed publication boundary, indefinite results/download/evidence, DB+local partial copies and raw-only cleanup including CLI temporary sessions. A24/A25/A26.

## 7. Notifications and responsive product

- [x] 7.1 Implement SMTP sender ownership/verification, changed-recipient verification, independent email/push settings and redacted delivery status. A22/A23.
- [ ] 7.2 Implement service-worker VAPID subscriptions, browser capability/permission flows and per-device expiry. A22 and supported-browser manual QA.
- [x] 7.3 Implement immediate execution-error and second-disagreement notification, zero/unchanged results, task-specific daily mute and midnight expiry. A13/A14/A20/A21/A23.
- [ ] 7.4 Implement ui-spec screens/tokens, source version/evidence, downloads, live state and keyboard/mobile workflows. A31.

## 8. Verification and operator delivery

- [ ] 8.1 Run Compose lint/typecheck/build/unit and PostgreSQL integration tests; cover all A01–A32 with command/fixture/result evidence.
- [ ] 8.2 Run parser/artifact fixture matrix, browser E2E and responsive/accessibility visual QA. Distinguish automation from real-device verification.
- [ ] 8.3 Complete approved live Google/CLI/SMTP/push smoke tests; list unavailable operator credentials as integration blockers rather than fake success.
- [ ] 8.4 Rehearse consistent DB/files/secrets/auth backup and Linux restore with hashes, permissions and no duplicate catch-up. A27/A28.
- [ ] 8.5 Update README/.env.example/operator guide and final report with exact versions, migrations, tested commands, live/mock distinctions, known limitations and default docker compose startup. Validate OpenSpec strict before declaring implementation complete.

## Implementation record (Claude, 2026-11-02)

체크 기준: 구현 + 해당 작업이 요구한 수준의 검증을 마쳤을 때만 [x]. 모의(mock) 검증은 live로 표기하지 않는다. A01–A32별 증거와 live/모의 구분은 `docs/acceptance-evidence.md`, 정확한 버전은 `docs/versions.md`, 운영 절차는 `docs/operator-guide.md`.

- 2.1 최신 정식 호환 조합 확정(TypeScript 7은 Kit 3 peer 불일치로 6.0.3), package-lock.json, Compose 내 `npm install`/빌드 검증. 이미지 digest·CLI·apt 도구 버전 기록.
- 2.2 cli-runner 이미지에 Claude Code 2.1.316 / Codex 0.166.0. 소유자 구독 로그인(Claude Pro, ChatGPT) 후 **LIVE**: 두 CLI 모두 schema-valid JSON 반환, API 과금 env 없음(존재 시 runner가 실행 거부), runner 재빌드·전체 force-recreate 후 로그인 유지.
- 2.3 CLI를 web/worker와 분리된 `cli-runner`(사용자 파일·DB 네트워크·Docker socket 없음, read-only rootfs, tools 비활성: Claude `--tools "" --safe-mode --strict-mcp-config`, Codex 도구 기능 disable + read-only sandbox + ephemeral)로 실행. **LIVE** 주입 probe(인증파일·/data 읽기·외부 전송 지시) 미수행·비밀 미유출, 직접 명령 실행 지시에도 실행 불가(tool 0). Codex 시작 notice("code mode … will fail closed")는 도구가 아니라 비활성 확인 메시지로 판정해 계수에서 제외.
- 2.4 web/worker/migrate/cli-runner 서비스, healthcheck, non-root, init, cap_drop ALL, no-new-privileges, SIGTERM graceful shutdown(worker는 claim 중지 후 active run을 interrupted 처리). `docker compose up -d --build --wait` 및 force-recreate 검증. db는 internal 네트워크만.
- 3.1 Drizzle SQL migration 0000(28 테이블, check/partial unique/index) + 0001(notifications.claimed_at, push per-owner unique). 새 DB(통합 테스트 DB 재생성)와 기존 DB(dev 0000→0001) 모두 적용 확인. AES-256-GCM 비밀값 암호화, outbox는 완료 트랜잭션 안에서 commit.
- 3.2 초대 allowlist, bootstrap 관리자, Google OIDC(openid-client, PKCE/state/nonce/issuer/audience/verified email), opaque 세션 hash, CSRF 헤더 + Origin 검사, owner 범위 API/SSE/다운로드. 통합 테스트(모의 OIDC claim). **실제 Google 로그인 미검증 → 8.3.**
- 3.3 **미완료 표시 유지**: 별도 drive.file OAuth, Picker 설정 API, 서버 확인 후 grant 등록, 허용 목록 검색, 연결 해제(예약 일시중지) 구현·자동 테스트. 실제 동의/Picker는 운영자 Google 프로젝트 값이 없어 미검증.
- 3.4 알림 설정·암호화 SMTP 프로필(실제 verify 경로)·storage root(pending_mount, 실제 마운트·쓰기 확인 후 활성, 복사→hash→참조 갱신 이전). traversal/symlink 거부 유닛 테스트.
- 4.1 결정적 자연어 해석기(연구 예시 기본값 미부여, 모호 항목만 질문), revision 확인 후 활성화, 시간대 확인. CLI 보조 계획 생성(선택 기능)은 구현하지 않음 — 모든 계획은 코드 해석 + 사용자 편집.
- 4.2 실행 큐: runs 테이블 FIFO(eligible_at, created_at, id) + 사용자 lane + 전역 동시성(advisory lock, SKIP LOCKED). pg-boss 큐 전부 retryLimit 0(스케줄러 cron, 알림, 정리, dispatch).
- 4.3 occurrence 고유키, 누락 병합 1회, 같은 file id 재캡처, lease 만료 run interrupted. 복구 리허설에서 중복 없음.
- 4.4 취소/timeout 시 양쪽 CLI 중단·부분 보관·재시도 없음, lease 60s/heartbeat 15s, 수동 재실행은 새 run.
- 5.1 바이트 hash·manifest 동결, 캡처 중 변경 감지, 2차 검토는 동결 manifest(hash 검증) 재사용.
- 5.2 xlsx/xls/pptx/ppt/pdf(텍스트+OCR)/이미지/csv/tsv 파서, 근거 위치, 크기/OCR 한도(잘라내지 않고 오류). fixture 매트릭스 49 통과, 3 skip(암호화 ppt·OOXML은 이 도구로 생성 불가).
- 5.3 날짜 창·필터·집계 결정적 검산(정확한 10진수, 확인 불가 날짜 미보정 경고).
- 5.4 xlsx/pptx/pdf/csv/tsv/png/jpeg 생성 후 재열기 검증, PDF/PPT 렌더 미리보기(한글 육안 확인), 원본 hash 불변.
- 5.5 외부 전송 1회 승인(hash·대상·행위 결합, 변경 시 무효, 단일 실행). 모의 Drive 업로드로 검증, 실제 업로드는 8.3.
- 6.1 **LIVE**: 실제 Claude+Codex 독립 실행(같은 캡처, 새 세션, 각 1회) → 코드 검산 → Claude reviewer agree → completed.
- 6.2 코드 검산 우선(실패 시 reviewer 미호출), 양쪽 결과·필드 차이 저장, 재검토 피드백은 불일치 사실만.
- 6.3 사용자별 Claude→Codex 교대, 완료 트랜잭션 행 잠금 + last_advanced_run_id로 정확히 1회.
- 6.4 완료 경계(결과·근거·다운로드·outbox 원자 commit) 후 raw만 정리, 오류/검토 시 DB + 로컬 복사 경로 기록. 실행 중 발견한 이벤트 seq 경합 버그 수정.
- 7.1 SMTP 발신 권한/검증, 수신처 코드 검증, 독립 채널, 마스킹된 전달 상태. 모의 전송만 검증 → 실제는 8.3.
- 7.2 **미완료**: service worker·VAPID 구독 API/UI 구현, 실제 브라우저 권한·기기 수동 QA 미수행.
- 7.3 즉시 오류 알림, 2차 불일치 알림, 0건 알림, 작업별 당일 mute(KST 자정), 오류는 mute 예외.
- 8.1 **미완료**: lint(prettier)·svelte-check·build·유닛·통합 통과. A26(디스크 가득참/DB 중단 주입) 테스트 미수행.
- 8.3 **미완료**: CLI live 완료. Google OAuth/Picker, SMTP, Web Push, ngrok은 운영자 자격 증명 미제공으로 미검증(통합 차단 요인).
- 8.4 **미완료**: `scripts/backup.sh`/`restore.sh` 작성, Docker Desktop(Linux 컨테이너)에서 별도 Compose 프로젝트로 백업→복원 리허설(hash·행 수·파일·인증 volume·중복 catch-up 없음) 통과. 실제 별도 Linux 호스트 이전은 미수행.
