## 1. Verify provider feasibility

- [ ] 1.1 Verify live whether Google Picker folder selection under drive.file allows recursive enumeration and download; record result and, if not, confirm the alternative with the user.
- [ ] 1.2 Register/verify a Microsoft Entra app (operator input) and verify the minimal OneDrive delegated permission for user-selected files/folders with personal and work accounts.

## 2. Source provider abstraction

- [ ] 2.1 Introduce SourceProvider interface and move Google Drive file capture behind it without behaviour change (existing tests stay green).
- [ ] 2.2 Add source_targets / uploaded_originals schema, TaskPlan schema_version 2 with source_target_id, and a migration converting existing plans and file_grants.

## 3. Prompt attachments

- [x] 3.1 Upload API (size/type checks, atomic retained original, sha256), owner isolation, explicit delete with dependent-task confirmation. `POST/GET /api/uploads`, `DELETE /api/uploads/:id`; ZIP unpacked into per-file originals with listed skips (user decision 2026-11-02, design.md "첨부 업로드 결정"). Delete is refused (CONFLICT with task names) while a non-archived task uses the file; a confirm-and-pause flow and an uploads management list are not built yet.
- [ ] 3.2 Capture from retained originals; cleanup never deletes originals; UI attach in the request box and plan editor. Done: capture from the retained original with sha256 check, cleanup leaves originals, request-box attach (+ button, drag and drop, Ctrl+V paste) on home, plan editor/task page display upload sources. Not done: attaching from the plan editor.
- 2026-11-03: after rebasing onto the Word/Hangul parsers (6.1), uploads also accept docx·docm·doc·hwpx·hwp (content check: zip or CFB container, or the HWP 3.x signature; the parser then decides by container). Re-validated on the rebased branch: svelte-check 0/0; vitest unit+integration 196 passed / 4 skipped; Playwright 23/23 (isolated `yeeun-upload` stack).
- Validation 2026-11-02 (isolated Compose stack `yeeun-upload`, separate DB/port, branch build): svelte-check 0 errors/0 warnings; vitest unit+integration 165 passed / 3 skipped (new: `src/lib/server/uploads/inspect.test.ts` 10, `tests/integration/uploads.test.ts` 5 — real storage + DB, no CLI); Playwright 23/23 passed incl. new `tests/e2e/attachments.spec.ts` (4) and the existing responsive/axe suite. Drag-and-drop and paste were exercised with synthetic DragEvent/ClipboardEvent in Chromium; an OS-level drag from Explorer and Ctrl+V of a file copied in Explorer were not automated and still need a manual check. The E2E seed now hands the storage `users/` tree to uid 1000 so web can create `originals/`.

## 4. Folders and OneDrive

- [ ] 4.1 Google Drive folder targets (per 1.1 outcome): recursive enumeration, frozen folder manifest, skipped-file reasons, run file/byte limits.
- [ ] 4.2 OneDrive connect/disconnect, File Picker selection, server-verified targets, file and folder capture with eTag versions.
- [ ] 4.3 Verify prompts, checks and result tables across multi-file folder manifests (evidence per file).

## 5. Natural-language Drive discovery

- [x] 5.1 Request drive.readonly alongside drive.file; name/type search of the user's Drive returning candidates only; confirmed candidate becomes a grant; reconnect message when readonly was declined. Integration tests with mocked Drive API (3), E2E 19 passed after UI change.
- [ ] 5.2 Live check after the operator publishes the OAuth app and the user reconnects Drive.

## 6. Word and Hangul inputs

- [x] 6.1 docx/docm (XML only, no macros), doc (isolated LibreOffice), hwpx (OWPML), hwp 5.x (cfb + own record parser; password/distribution/DRM → PARSE_FAILED), hwp 3.x via LibreOffice; tables follow the derivable evidence-id convention; empty paragraphs dropped and short ones merged for prompt size. Parser suite 76 passed / 4 skipped; two real Hancom files (hwp 5.1 contract, hwpx rules) parsed correctly in a one-off check (not stored in the repo).
- [ ] 6.2 Run one real Word and one real Hangul file through a full live dual-CLI run from Drive.

## 7. Verification

- [ ] 7.1 Unit/integration tests per provider (mock) plus live smoke with the operator's Google and Microsoft accounts; record live vs mock.
- [ ] 7.2 E2E for attach → plan → run, folder target with added file between runs, skipped-file display; update docs and OpenSpec strict validation.
