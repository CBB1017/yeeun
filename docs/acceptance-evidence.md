# 인수 검사 증거 (A01–A32)

검증일 2026-11-02. 구분: **LIVE** = 실제 계정/서비스, **AUTO** = 자동 테스트(모의 CLI·모의 Drive·모의 전송 포함, 이름에 `[MOCK]` 표기), **미검증** = 아직 증거 없음.

명령:
- 유닛 `docker compose run --rm test npx vitest run --project unit`
- 통합 `docker compose run --rm -e TEST_DATABASE_NAME=yeeun_test_core test npx vitest run --project integration`
- 라이브 `docker compose run --rm -e LIVE_CLI=1 -e TEST_DATABASE_NAME=yeeun_test_live test npx vitest run --project live`
- E2E `docker compose --profile e2e run --rm e2e npx playwright test`

| ID | 증거 | 구분 | 남은 한계 |
|---|---|---|---|
| A01 | `tests/integration/auth-actions.test.ts` 미초대·미확인 이메일 거부, bootstrap 관리자, subject 바인딩, revoke 즉시 세션 차단 | AUTO (OIDC claim 모의) | 실제 Google OIDC 로그인 미검증(OAuth 클라이언트 미제공) |
| A02 | 통합 `A02` (run/detail/cancel 404), 알림 `resend` 소유권, 외부 승인 타 사용자 404, E2E 타 사용자 run | AUTO | — |
| A03 | `auth-actions` 허용 목록 검색(타 사용자 grant 제외, Drive API 미호출), 해석기 복수 후보 질문 | AUTO | 실제 Picker 동의·drive.file 미검증 |
| A04 | Drive 연결은 별도 OAuth(drive.file); 미연결 시 `DRIVE_REAUTH_REQUIRED`/계획 질문 | AUTO(코드 경로) | 실제 동의 화면 미검증 |
| A05 | `interpret.test.ts` 다른 업무에 연구/요일/시각/공휴일 미부여, 모호하면 질문 | AUTO | — |
| A06 | 해석기 월~목 10/14 + 시간대 확인 질문, `schedule math` 다음 실행 시각 | AUTO | 실제 예약 시각 경과 실행은 미관찰(스케줄러 tick 통합 테스트로 대체) |
| A07 | `checks.test.ts` 11/1→11/30, 11/2→12/1, 잘못된 날짜 미보정; `verify.test.ts` 미확인 날짜 경고 | AUTO | — |
| A08 | 통합: 권한 취소 grant → `SOURCE_MISSING`, 대체 파일 없음; 캡처 중 변경 → `SOURCE_CHANGED_DURING_CAPTURE` | AUTO (모의 Drive) | 실제 Drive 수정/이름변경 미검증 |
| A09 | 통합: 두 CLI 각 1회, provider 줄 외 동일 프롬프트, 상대 결과 미포함; **LIVE**: 실제 Claude+Codex가 같은 캡처를 각 1회 분석 | LIVE + AUTO | — |
| A10 | 통합: 표현 다른 요약 일치, 원본 헤더·순서 유지; **LIVE** 실제 두 결과 agree → completed | LIVE + AUTO | — |
| A11 | 통합·유닛: 레코드 초과 + reviewer agree → 서버가 불일치, reviewer 미호출; 소수 정확 비교 | AUTO | — |
| A12 | 통합: 원본 변경 후 재검토가 최초 manifest hash 사용, 동시 2회 요청 → 1회, 사실만 피드백 | AUTO | — |
| A13 | 통합: 2차 불일치 → disagreed + 오류 알림 outbox, 3차 없음 | AUTO | 실제 메일 수신 미검증 |
| A14 | 통합: usage limit → 즉시 failed·sibling 중단·재시도 없음; 잘못된 JSON → `OUTPUT_SCHEMA_INVALID`; 취소/timeout 양쪽 중단·부분 보관 | AUTO | 실제 사용량 한도/5xx 미유발 |
| A15 | 통합: 최초 Claude → 성공 후 Codex → 다시 Claude, 실패/불일치 미교대, 같은 run 2회 advance → 1회; LIVE 실행도 reviewer=claude | LIVE + AUTO | — |
| A16 | 통합: 검토 대기 lane 보유, 다른 사용자 실행, 대기 사유 `lane_review` | AUTO | — |
| A17 | 통합: 8일 누락 → catch-up 1회, 반복 tick 0건; lease 만료 → interrupted·재실행 없음; 복구 리허설에서 중복 없음 | AUTO + 리허설 | — |
| A18 | `artifacts/generate.test.ts` 전 형식 재열기 검증·원본 hash 불변; executor가 완료 전 스냅샷 hash 재확인 | AUTO | — |
| A19 | `auth-actions` 잘못된 hash 거부, 타 사용자 거부, 1회 실행, 변경 시 무효화 | AUTO (모의 Drive 업로드) | 실제 Drive 복사 업로드 미검증 |
| A20 | executor 0건 → `zero_result` 알림 이벤트; UI 0건 + "오늘은 알림 더 표시 안함" | AUTO | 실제 수신 미검증 |
| A21 | `notify.int.test.ts` 해당 작업 정상 알림만 억제, 오류/다른 작업 유지, KST 23:59:59/00:00 경계 | AUTO | — |
| A22 | `notify.int.test.ts` 선택 채널만, push 거부/미지원 시 메일 자동 활성화 없음 | AUTO | 실제 브라우저 권한·기기 미검증 |
| A23 | `notify.int.test.ts` SMTP 실패 → delivery_failed, push 1회 성공, 재호출 시 재시도 없음 | AUTO (모의 전송) | 실제 SMTP/푸시 미검증 |
| A24 | 통합: 완료 후 raw 스냅샷·manifest만 삭제, 결과·다운로드·근거·버전 유지, 정리 멱등 | AUTO | — |
| A25 | 통합: 불일치/오류 시 DB + 로컬 partial JSON(경로 기록), 스냅샷 유지 | AUTO | — |
| A26 | executor: 부분 보관 실패 시 `file_only/db_only/retention_failed` 기록, 저장 실패 시 completed 금지(트랜잭션), 정리 실패는 정리만 재시도 | 코드 검토 | **디스크 가득참/DB 중단 주입 테스트 미수행** |
| A27 | `storage.test.ts` traversal·symlink·사용자 파일명 거부; root 변경 pending_mount; 복구 리허설에서 hash 검증 | AUTO + 리허설 | 실제 다른 호스트 경로 마운트 전환 미검증 |
| A28 | `docker compose up -d --build --force-recreate --wait` 후 DB·파일·CLI 로그인 유지, 모든 healthcheck 통과 | LIVE(로컬 Docker Desktop) | 별도 Linux 호스트 미검증 |
| A29 | **LIVE**: Claude Pro / ChatGPT 구독 로그인, API 과금 env 없음, 두 CLI schema-valid JSON, 컨테이너 재생성 후 로그인 유지 | LIVE | — |
| A30 | **LIVE**: 자료 속 지시(인증파일·/data 읽기, 외부 전송) 미수행·비밀 미유출; 직접 명령 실행 지시에도 실행 불가(`could_execute=false`, tool 0); 구조적으로 runner에 /data·DB 없음 | LIVE | — |
| A31 | `tests/e2e/responsive.spec.ts`: 10개 화면+로그인 × 375/768/1024/1440 페이지 가로 넘침 없음·표 내부 스크롤, axe serious/critical 0, 44px 터치; `flows.spec.ts` 키보드 전용 재검토·근거 패널 포커스 트랩 | AUTO (headless Chromium) | 실제 기기·스크린리더 수동 QA 미수행 |
| A32 | 통합: 중복 Idempotency-Key 1건, advance 1회, 이벤트 seq 동시성(실제 버그 수정); SSE 재연결 cursor replay 구현 | AUTO | worker kill 중 SSE 연속성 E2E 미수행 |
