## ADDED Requirements

### Requirement: Email and browser push channels
The system SHALL limit notification delivery channels to email and browser push. A native mobile app is outside the current scope.

Users SHALL be able to select email and browser push independently and change sender/recipient settings according to the configured account permissions. Administrator-managed invitations SHALL govern application access.

#### Scenario: Report notification
- **WHEN** a scheduled report is ready for notification
- **THEN** notification delivery uses email and/or browser push according to the confirmed channel configuration

### Requirement: Empty-result notification
The system SHALL notify the user even when a scheduled research report contains zero matching records and offer the action "오늘은 알림 더 표시 안함".

#### Scenario: No matching research projects
- **WHEN** a successful report contains no matching projects
- **THEN** the user is notified of the zero-result outcome
- **AND** the user is offered "오늘은 알림 더 표시 안함"

### Requirement: Mute the current job's normal notifications for today
The system SHALL apply the user's "오늘은 알림 더 표시 안함" action to normal email and browser push notifications for the selected recurring job until the next midnight in Asia/Seoul. Analysis SHALL continue while muted, and error notifications SHALL bypass the mute.

#### Scenario: Later normal result on the same day
- **WHEN** a muted job produces a normal result before the next Asia/Seoul midnight
- **THEN** its normal email and browser push notifications are suppressed
- **AND** analysis and result storage continue
- **AND** notification preferences for other jobs are not changed

#### Scenario: Error while muted
- **WHEN** a muted job encounters an error requiring notification
- **THEN** its error notification is not suppressed by the daily mute

#### Scenario: Next day
- **WHEN** the next Asia/Seoul midnight is reached
- **THEN** the daily mute expires
