# Invitation email delivery

Reuse realTransports and resolveSender(adminId). Synchronous bounded SMTP attempt after the invitation transaction commits; invitation creation does not roll back on mail rejection. Invitation rows track status, attempt revision, attempted/sent timestamps and redacted error. This avoids requiring a recipient user account or task-notification preferences for a user not registered yet.

Claim through a conditional update on active status, non-sending email state and expected attempt count. The count increments before SMTP; repeated stale requests return current state without resending. A concurrent sending attempt returns conflict. Every explicit retry uses the last observed count. No background worker polls historical invitations. Crashed sending attempts remain uncertain; administrator may explicitly retry after the bounded timeout and UI warns about possible duplicate receipt.

Invitation messages contain no login token; recipient still must authenticate as the invited Google account. Revoke remains the authorization boundary even if an already-in-flight email arrives. The API is admin-only and requires existing Origin/CSRF checks. Sender profile credentials are not exposed.

Tests use mocks and an isolated test database. A live invitation is not generated during deployment. Additive migration is safe for existing rows; rebuild/migrate before deploying schema-reading web code.
