## ADDED Requirements

### Requirement: Send an invitation message on explicit invitation
The system SHALL attempt one invitation email when an administrator explicitly creates an invitation. It SHALL use a configured authorized SMTP sender and include the service login link and invited Google account, without authentication secrets.

#### Scenario: New invitation
- **WHEN** the administrator creates an invitation
- **THEN** the login allowlist entry is created and one invitation email is attempted

### Requirement: Separate permission from delivery state
The system SHALL retain a valid invitation if SMTP delivery fails and SHALL expose delivery state separately from account invitation status. SMTP acceptance SHALL NOT be represented as inbox receipt.

#### Scenario: SMTP rejects the message
- **WHEN** the invitation email attempt fails
- **THEN** the invitation remains active and its email state is failed with a redacted error
- **AND** no automatic retry occurs

### Requirement: Explicit versioned manual sending
The system SHALL allow administrators to send or resend email for active invitations using an expected delivery-attempt revision. It SHALL NOT send automatically to historical invitations or send for accepted or revoked invitations.

#### Scenario: Duplicate manual request
- **WHEN** two requests use the same expected attempt revision
- **THEN** at most one new SMTP attempt is started

#### Scenario: Historical invitation
- **WHEN** the migration adds delivery fields to an existing invitation
- **THEN** it is marked not requested and no message is sent until an administrator acts
