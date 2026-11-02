## Implementation

- [x] 1. Add versioned invitation email delivery fields and migration with historical rows not requested.
- [x] 2. Implement authorized SMTP message delivery, redacted failure persistence and duplicate request guards.
- [x] 3. Connect invitation creation and admin-only manual sending API.
- [x] 4. Show delivery states and explicit send/resend in the admin screen.
- [x] 5. Test success, failure, missing sender, duplicate/concurrent request and accepted/revoked/admin guards using mock SMTP and isolated PostgreSQL.
- [x] 6. Validate types/build/OpenSpec; migrate and recreate the affected service without sending real invitations.

## Validation

- Svelte/TypeScript: 0 errors, 0 warnings.
- Isolated PostgreSQL + mock SMTP: 10 related tests passed (6 new delivery cases, 4 existing auth/actions cases). No live test mail.
- Production web/migrate image build passed using git HEAD plus invitation-only changes; unrelated in-progress parser changes were not included in this deployment.
- OpenSpec strict validation passed.
- Additive migration applied; web recreated healthy. Existing invitations remained not_requested and no historical email was sent.
- SMTP connection/auth verification passed from the new web container. This does not prove inbox delivery; no real invitation was created or sent during verification.
