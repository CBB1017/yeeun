# v1.0 multi-source file and folder targets

## Why

2026-11-02 사용자는 version 1.0을 "프롬프트에 첨부한 파일이든 OneDrive든 다른 클라우드든, 대상 파일이나 폴더에 대해 요청한 작업을 수행하는 것"으로 정의했다. 선행 change `establish-local-dual-cli-automation`은 명시적으로 고른 Google Drive **파일**만 다룬다. v1.0은 원본 출처와 대상 단위(파일/폴더)를 넓힌다.

## What Changes

- 원본 출처를 provider 추상화로 일반화: `upload`(프롬프트 첨부), `google_drive`, `onedrive`. 다른 클라우드(N드라이브 등)는 v1.0 범위 밖이며 같은 인터페이스로 추후 추가한다.
- 프롬프트 첨부 파일: 업로드한 바이트 자체를 **업무 원본으로 계속 보관**하고 재실행·예약에 다시 사용한다. 삭제는 사용자의 명시적 동작으로만 한다. 정상 완료 후 삭제되는 것은 실행별 raw 스냅샷뿐이다.
- OneDrive: Microsoft 계정 OAuth와 파일 선택기로 사용자가 고른 파일/폴더만 허용한다.
- 폴더 대상: 실행할 때마다 그 폴더의 **현재 내용 전체를 하위 폴더까지** 다시 열거해 캡처한다. 새 파일도 포함한다. 열거 결과(파일 ID·경로·버전·hash)를 manifest에 고정하고 두 CLI와 2차 검토는 같은 캡처를 쓴다.
- 지원하지 않는 형식·한도 초과 파일은 조용히 빼지 않고 실행 화면과 결과에 목록으로 표시한다. 총량 한도를 넘으면 일부만 처리하지 않고 오류로 멈춘다.
- 기존 불변 조건 유지: 초대 사용자, 원본 수정·삭제 금지, LLM API 금지, 같은 원본 독립 2회 실행·검산·대조, 사용자별 라운드로빈, 자동 재시도 금지, Compose 우선.

## Capabilities

### New Capabilities

- `source-targets`: 원본 provider, 첨부 업로드 보관, OneDrive 허용, 폴더 대상 재귀 열거, 폴더 캡처 manifest.

### Modified Capabilities

없음(선행 change가 아직 archive 전이라 delta 대신 새 capability로 정의하고, 선행 `drive-file-reference`의 "파일만" 범위를 이 capability가 폴더·다른 출처로 확장한다).

## Impact

DB: source_targets(provider, kind file|folder, 외부 ID 또는 업로드 원본 참조), uploaded_originals, 폴더 열거 결과. Worker: provider별 열거·다운로드, 폴더 manifest. Web: 첨부 업로드, OneDrive 연결/선택기, 폴더 대상 표시. 운영자 입력: Microsoft Entra 앱 등록(client ID/secret, redirect URI). 기술 확인이 필요한 위험은 design.md의 "검증 필요"에 기록하며, 최소 권한으로 폴더 접근이 불가능하면 넓은 권한으로 조용히 바꾸지 않고 사용자에게 대안을 확인한다.
