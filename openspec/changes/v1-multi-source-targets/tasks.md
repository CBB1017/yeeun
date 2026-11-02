## 1. Verify provider feasibility

- [ ] 1.1 Verify live whether Google Picker folder selection under drive.file allows recursive enumeration and download; record result and, if not, confirm the alternative with the user.
- [ ] 1.2 Register/verify a Microsoft Entra app (operator input) and verify the minimal OneDrive delegated permission for user-selected files/folders with personal and work accounts.

## 2. Source provider abstraction

- [ ] 2.1 Introduce SourceProvider interface and move Google Drive file capture behind it without behaviour change (existing tests stay green).
- [ ] 2.2 Add source_targets / uploaded_originals schema, TaskPlan schema_version 2 with source_target_id, and a migration converting existing plans and file_grants.

## 3. Prompt attachments

- [ ] 3.1 Upload API (size/type checks, atomic retained original, sha256), owner isolation, explicit delete with dependent-task confirmation.
- [ ] 3.2 Capture from retained originals; cleanup never deletes originals; UI attach in the request box and plan editor.

## 4. Folders and OneDrive

- [ ] 4.1 Google Drive folder targets (per 1.1 outcome): recursive enumeration, frozen folder manifest, skipped-file reasons, run file/byte limits.
- [ ] 4.2 OneDrive connect/disconnect, File Picker selection, server-verified targets, file and folder capture with eTag versions.
- [ ] 4.3 Verify prompts, checks and result tables across multi-file folder manifests (evidence per file).

## 5. Natural-language Drive discovery

- [x] 5.1 Request drive.readonly alongside drive.file; name/type search of the user's Drive returning candidates only; confirmed candidate becomes a grant; reconnect message when readonly was declined. Integration tests with mocked Drive API (3), E2E 19 passed after UI change.
- [ ] 5.2 Live check after the operator publishes the OAuth app and the user reconnects Drive.

## 6. Verification

- [ ] 6.1 Unit/integration tests per provider (mock) plus live smoke with the operator's Google and Microsoft accounts; record live vs mock.
- [ ] 6.2 E2E for attach → plan → run, folder target with added file between runs, skipped-file display; update docs and OpenSpec strict validation.
