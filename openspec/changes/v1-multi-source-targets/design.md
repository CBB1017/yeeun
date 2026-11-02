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
3. 업로드 한도·형식: 기존 `MAX_SOURCE_FILE_BYTES` 적용. ~~압축 파일(zip) 첨부는 v1.0에서 지원하지 않고 명시적으로 거부.~~ → 아래 "첨부 업로드 결정"으로 대체.

## 첨부 업로드 결정 (2026-11-02, 사용자 요청으로 구현)

- 홈 요청 입력란에서 **+ 버튼(파일 선택), 끌어다 놓기, Ctrl+V 붙여넣기**로 PC 파일을 첨부한다. 허용 확장자: xlsx·xlsm·xls·pptx·ppt·pdf·csv·tsv·png·jpg·jpeg·webp·**zip**.
- **zip 허용**(위 3번 대체): 업로드 시 서버가 풀어 분석 가능한 항목 하나하나를 별도 보관 원본(`uploaded_originals`, `archive_name`에 zip 이름, `display_name`에 zip 내부 경로)으로 저장한다. 지원하지 않는 형식·중첩 압축·운영체제 부가 파일(`__MACOSX/`, `.DS_Store` 등)·빈 파일·확장자와 내용 불일치·파일당 한도 초과 항목은 조용히 빼지 않고 `skipped[]`(사유)로 응답·화면에 표시한다. 암호/손상 zip, 항목 2,000개 초과, 푼 총량 `MAX_RUN_SOURCE_BYTES` 초과, 분석 가능 파일 10개 초과, 분석 가능 파일 0개는 zip 전체를 오류로 거부한다(일부만 저장하지 않음). 크기는 선언값이 아니라 실제로 푼 바이트로 세고 한도를 넘는 즉시 중단한다. 비 UTF-8 이름은 CP949로 해석한다.
- 한 요청의 첨부 파일 수는 계획 원본 한도와 같은 10개(zip은 푼 파일 수 기준).
- 단일 파일도 확장자와 내용 서명(PK/CFB/%PDF/PNG/JPEG/RIFF-WEBP, CSV·TSV는 NUL 없음)이 맞아야 저장한다.
- 붙여넣기: 클립보드에 파일만 있으면(탐색기에서 복사한 파일, 스크린샷) 첨부한다. 텍스트가 함께 있으면(엑셀 셀 복사는 셀 그림도 함께 담김) 평소처럼 텍스트만 붙여넣는다. 이름 없는 스크린샷은 `붙여넣은 이미지 YYYYMMDD-HHMMSS.png`.
- 첨부는 고르는 즉시 업로드하고(진행률 표시), "계획 만들기"는 업로드 완료 후 `upload_ids`와 함께 초안을 만든다. 첨부가 있으면 그 파일들이 순서대로 계획 원본이 되고 Drive 파일 매칭 질문은 하지 않는다.
- 전송 전 첨부를 빼면 저장된 원본도 삭제한다. 삭제는 보관되지 않은 업무가 그 원본을 쓰는 동안 거부한다(업무 이름 표시).
- 데이터: 이번 단계는 `source_targets`/schema_version 2 대신 기존 TaskPlan v1의 `sources[]`를 `{grant_id,…}` | `{upload_id,…}` 합집합으로 넓히고, `task_sources.grant_id`를 nullable로 바꿔 `upload_id`와 정확히 하나만 갖게 했다(기존 계획 변환 불필요). provider 추상화(2.1/2.2)는 OneDrive·폴더 작업 때 진행한다.
- 업로드 API는 multipart가 아니라 파일당 raw body(`application/octet-stream`, 이름은 `x-file-name` URI 인코딩) 한 번. web의 `BODY_SIZE_LIMIT`을 `MAX_SOURCE_FILE_BYTES`로 올리고, JSON API 본문은 앱에서 2MB로 따로 제한한다.
