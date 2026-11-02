# v1.0 multi-source 설계

## 사용자 결정 (2026-11-02)

- 대상: 프롬프트 첨부 파일, Google Drive, OneDrive. 다른 클라우드(N드라이브 등)는 현재 단계에서 제외하되 확장 가능한 구조로 둔다.
- 폴더: 실행할 때마다 하위 폴더까지 현재 내용 전체.
- 첨부: 업무 원본으로 계속 보관(사용자가 직접 삭제).
- **Drive 자연어 탐색(2026-11-02 추가 결정)**: 사용자가 Picker로 일일이 고르는 대신 앱이 자연어로 찾아 주기를 원함. `drive.readonly`(Google restricted scope)를 추가해 이름·형식으로 검색하고, 후보는 사용자가 앱에서 확인해야만 허용 목록에 들어간다. 선행 change의 "자연어 탐색에 광범위 Drive 권한을 요청하지 않는다" 조항은 이 사용자 결정으로 대체된다. `drive.file`은 결과 복사본 업로드용으로 유지. 테스트 상태 앱은 refresh token이 7일 후 만료되므로 OAuth 동의 화면을 게시(프로덕션)한다. 미검증 앱은 동의 화면 경고와 100명 제한이 있으며, 이를 없애려면 Google restricted scope 검증이 필요하다.

## 구조

`SourceProvider` 인터페이스(worker): `describe(target)`, `enumerate(target)`(폴더면 재귀), `capture(file)`(바이트 + 버전 메타, 캡처 중 변경 감지), `uploadCopy?`(외부 전송 승인 시 새 파일만). 기존 `drive/google.ts` + `sources/capture.ts`의 SourceFetcher를 이 인터페이스의 Google Drive 구현으로 옮긴다.

- `upload` provider: web이 multipart 업로드를 받아 크기·형식 확인 후 `users/<uuid>/originals/<uuid>.<ext>`에 원자적으로 저장, sha256과 원래 파일명(표시용, 경로에 사용 안 함)을 DB에 기록. 캡처는 이 보관본을 읽어 run 스냅샷으로 복사한다. 보관본은 cleanup 대상이 아니다.
- `google_drive` provider: 기존 파일 grant + 폴더 grant(Picker 폴더 선택).
- `onedrive` provider: Microsoft identity platform OAuth(개인/회사 계정), File Picker로 선택한 driveItem만 등록, Graph `/drives/{id}/items/{id}/children` 재귀 열거, `@microsoft.graph.downloadUrl`로 다운로드, eTag/cTag를 버전으로 기록.

데이터: `source_targets`(owner, provider, kind file|folder, external_id/drive_id 또는 uploaded_original_id, 표시 이름, status), `uploaded_originals`(owner, sha256, size, mime, display_name, storage path, deleted_at), 기존 `file_grants`는 google_drive 대상으로 이행. TaskPlan `sources[]`는 `source_target_id`를 참조한다(schema_version 2, 기존 v1 계획은 마이그레이션에서 변환).

폴더 manifest: 열거 순서 고정(경로 사전순), 파일별 provider ID·상대 경로·버전·hash, `skipped[]`(사유), 한도: `MAX_RUN_FILES`(기본 200), 기존 `MAX_RUN_SOURCE_BYTES`/`MAX_OCR_PAGES`. 열거·캡처 도중 폴더 변경은 파일 단위 변경 감지로만 판단하고, 열거 이후 추가된 파일은 다음 실행에 포함된다.

## 검증 필요 (구현 전 실제 확인, 실패 시 사용자에게 대안 확인)

1. **Google drive.file + 폴더**: Picker로 폴더를 고르면 drive.file 범위에서 그 폴더의 하위 파일 열거·다운로드가 허용되는지. 허용되지 않으면 대안: (a) 폴더 안 파일을 Picker 다중 선택으로 허용(새 파일 자동 포함 불가), (b) `drive.readonly`(전체 읽기, Google 검증 필요 restricted scope)로 앱이 폴더 범위만 사용 — 요구사항 "광범위 Drive 권한 금지"와 충돌하므로 사용자 승인 필요.
2. **OneDrive 최소 권한**: 개인 Microsoft 계정에서 선택 항목 한정 권한이 가능한지(File Picker v8 / `Files.Read` 위임 범위). 선택 항목 한정이 불가능하면 `Files.Read`(사용자 전체 파일 읽기)를 쓰되 앱은 선택 대상만 접근하는 방식이 되며, 이 역시 사용자 승인 후 적용.
3. 업로드 한도·형식: 기존 `MAX_SOURCE_FILE_BYTES` 적용, 압축 파일(zip) 첨부는 v1.0에서 지원하지 않고 명시적으로 거부.
