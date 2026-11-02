# 데이터·API·프로세스 계약

## 구조화 데이터

runtime schema validation, schema_version=1, unexpected fields 거부. 모델 내부 reasoning은 요구/저장하지 않는다.

| 객체 | 필수 내용 |
|---|---|
| TaskPlan | 서버 task/owner/revision, original_prompt, goal, typed operations, selected grant/file/selectors, web/download output format, raw+normalized schedule/IANA timezone/다음 실행 예시, date/unit/rounding policy, email/push, external action intent, unresolved_questions, 사용자 확인 revision/time |
| SourceManifest | run/snapshot, provider_file_id/name/MIME, provider_revision optional, provider_modified_at optional, capture_time, byte sha256, export_format, relative_path, extraction_version, evidence index; 다중 파일 전체 manifest hash |
| AnalysisResult | run/round/provider, manifest_hash, status(ok/unsupported/needs_input), summary, claims, records, artifact_plan, uncertainties |
| Claim | stable claim_key, typed value, unit, evidence_ids |
| Record | source_record_id, 원본 컬럼 ID·label·값, cell evidence |
| Comparison | reviewer/round/manifest, agree/disagree, field differences 및 양쪽 값·근거·reason, deterministic checks, final answer/artifact plan optional, uncertainties |

provider revision이 없으면 snapshot/hash를 별도 식별자로 보여준다. 수정시각만으로 정확한 byte version을 주장하지 않는다. evidence_id는 해당 manifest에서 실제 존재해야 한다. artifact_plan은 지원한 선언적 변환이며 임의 code/URL/network 동작이 아니다.

## CLI adapter

`claude -p` 및 `codex exec`가 기본 명령. 정확한 JSON/schema/도구 제한 flag는 설치한 CLI의 실제 help와 smoke test로 확인하고 검증 전 추정하지 않는다. prompt는 stdin, 인자는 배열. 전역 이전 세션을 재사용하지 않는다. API billing 환경변수는 worker에 전달하지 않는다.

run/round/provider별 input hash, CLI/model version(반환 가능 시), 종료코드, 시간, usage metadata를 기록한다. 원문 최종 결과는 사용자 권한으로 저장하되 stdout/stderr/log 전체를 무조건 보관하지 않는다. 토큰·소스 전문·credential은 로그에서 제거한다. raw session/추출 전문은 스냅샷 수명에 포함한다.

## API 원칙

응답 `{data,request_id}`, 오류 `{error:{code,message,stage,retryable:false},request_id}`. run/review/approval 생성은 Idempotency-Key, 계획 수정은 expected revision. 모든 mutation 인증/CSRF/schema 검증. 타 사용자 resource는 404. 재실행은 명시 user action이며 error flag로 자동 retry를 유도하지 않는다.

| Endpoint | 책임 |
|---|---|
| GET /api/me | 본인/역할/기능 가용성 |
| GET/POST/DELETE /api/admin/invitations | 관리자 초대/취소 |
| /auth/google/start, /callback, POST /logout | OIDC session |
| /api/drive/connect, /callback, DELETE /connection | 사용자 OAuth/연결 해제 |
| GET /api/drive/picker-config, POST /api/drive/grants | 제한된 picker 초기화, 서버 검증한 파일 허용 |
| GET /api/drive/files?q= | 활성 허용 목록 내 검색 |
| POST /api/task-drafts, PATCH /:id, POST /:id/confirm | 계획·질문·revision 확인 |
| GET /api/tasks, GET/PATCH /api/tasks/:id | 본인 업무/일정/pause/resume |
| POST /api/tasks/:id/runs | 새 수동 실행 enqueue |
| GET /api/runs/:id, /events | 상태/이벤트/SSE cursor replay |
| POST /api/runs/:id/review, /cancel | 2차 검토 1회, 취소 |
| GET /api/runs/:id/result, /evidence | 결과/원본 버전/근거 |
| GET /api/artifacts/:id/download | 권한 검사 후 stream, host path 비노출 |
| POST /api/external-actions/:id/approve, /reject | 현재 hash/대상에 1회 승인/거부 |
| GET/PATCH /api/settings/notifications | 독립 채널/verified recipient/permitted sender |
| POST/DELETE /api/settings/push-subscriptions | 본인 기기 등록/해제 |
| POST /api/tasks/:id/mute-today | 한국시간 다음 자정까지 정상 알림 숨김 |
| GET/PATCH /api/admin/settings/storage | root 변경 계획/적용 상태 |
| GET /health/live, /health/ready | process 및 DB/schema/config 준비 |

SSE 단절/중복 API는 실행을 취소/재생성하지 않는다. 수동 재실행/연결 취소/삭제의 의미는 UI 확인 단계에서 구분한다.

## 오류

AUTH_REQUIRED, INVITATION_REQUIRED, DRIVE_REAUTH_REQUIRED, SOURCE_MISSING, SOURCE_CHANGED_DURING_CAPTURE, UNSUPPORTED_FORMAT, PARSE_FAILED, CLI_AUTH_FAILED, USAGE_LIMIT, NETWORK_FAILED, UPSTREAM_5XX, EXECUTION_FAILED, OUTPUT_SCHEMA_INVALID, TIMEOUT, CANCELLED, INTERRUPTED, STORAGE_FAILED, DELIVERY_FAILED, INPUT_REQUIRED를 구분한다. 검산 실패는 disagreement이며 자동 내부 500으로 처리하지 않는다. 오류는 단계/대응 방법/자료 보존 상태를 표시하며 민감 본문은 넣지 않는다.

## 논리 DB 모델

UUID PK, UTC timestamptz, 사용자 locale/timezone 별도. 사용자 자료에 owner_id 및 FK/index/상태 constraint, 서버 권한 검사. 앱 run ID가 authoritative이며 pg-boss schema는 분리한다.

| 테이블 | 주요 데이터/제약 |
|---|---|
| users/invitations/sessions | google_sub unique, verified email, role/active; active invitation email unique; hashed opaque session/expiry/revocation |
| oauth_connections/file_grants | owner/provider subject/scopes/encrypted token; connection/file unique 및 active |
| task_drafts/tasks/task_sources | 원문·plan schema/revision/확인, 상태/알림, 선택 파일 ID·selector |
| schedules/schedule_occurrences | rule/timezone/revision/next_due/watermark; unique(task,revision,scheduled_for), missed range/count |
| runs/run_events | trigger/state/round/assigned reviewer/plan revision/manifest/lease/heartbeat/times/parent; unique(run,event_seq) |
| source_snapshots/evidence | byte hash/path/version/deletion status; source position/excerpt/preview는 raw 삭제 후 유지 |
| cli_executions/comparisons | unique(run,round,provider), input hash/result/error/usage; unique(run,round) comparison/checks |
| results/artifacts/retained_copies | run answer/version metadata; root ID/relative path/MIME/name/size/hash/validation; DB partial result 및 별도 로컬 복사 경로 |
| reviewer_state | owner PK, next_provider default claude, revision, 완료 transaction row lock |
| notification_settings/smtp_profiles | 독립 채널/verified recipient/permitted profile; profile owner/admin 권한/encrypted credentials |
| notifications/push_subscriptions/mute_rules | unique(event,channel,destination), delivery state; encrypted endpoint/keys + hash; owner/task unique mute_until |
| external_actions | artifact hash/destination/action, approval revision, pending/approved/executed/rejected/failed; single use |
| storage_roots/audit_events | host label/container root/active; actor/action/resource/time/request ID, no content/token |

completed commit은 result pointer, reviewer advance, outbox를 원자적으로 묶는다. 파일은 임시 쓰기·close/fsync·atomic rename 후 DB 게시. 긴 CLI 호출 중 DB transaction을 유지하지 않는다. queue expiry/redelivery는 `(run,round,provider)` claim으로 중복 실행을 막는다.

## 보관

host `<project>/file` -> container `/data`. `users/<uuid>/runs/<uuid>/{snapshots,evidence,results,artifacts}`. 사용자 filename을 경로로 쓰지 않고 traversal/symlink로 root 탈출을 차단한다. DB에 storage_root_id + relative path + container context를 기록해 Linux 이전 후에도 복구한다.

완료 commit 후 raw/전체 추출·변환 임시본/CLI raw session만 deletion_pending -> idempotent 삭제 -> deleted_at. metadata/evidence excerpt·preview/result/download는 자동 만료 없음. 근거 preview를 원본 전문의 숨은 복사본으로 만들지 않는다. cleanup 실패는 경고·cleanup 재시도만 가능하며 분석 rerun 금지.

error/review/disagreed/interrupted/cancelled는 원본/가용 결과를 자동 삭제하지 않는다. DB 및 별도 local copy, 경로/hash 기록. DB/disk 실패로 한쪽 저장 불가면 가능한 쪽 보존·부분 보관 상태 통지, 복구 시 저장만 reconcile. 거짓 completed 금지.

Drive disconnect는 향후 읽기/관련 예약을 중지하고 기존 결과는 같은 사용자에게 유지한다. 자료 삭제는 별도 명시 확인, 활성 검토 자료 silent cascade 금지. root 변경은 admin만 가능하고 미마운트 경로면 operator_action_required. 기존 root 참조를 유지하며 명시 migration은 copy/hash검증/DB참조갱신 뒤 이전 파일 삭제 확인 순서다. Docker socket으로 동적 host mount 금지.
