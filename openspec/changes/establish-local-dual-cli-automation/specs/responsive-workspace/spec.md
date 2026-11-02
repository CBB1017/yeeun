## ADDED Requirements

### Requirement: Responsive browser workspace
The system SHALL provide a responsive browser interface for sign-in, file authorization, task planning/schedules, queue status, results/downloads, evidence, disagreement/review, and settings. A native or desktop application SHALL NOT be required.

#### Scenario: Use a narrow mobile viewport
- **WHEN** the user opens the workspace at 375 CSS pixels
- **THEN** all core actions and source table values remain accessible without full-page horizontal overflow
- **AND** evidence opens in a mobile-appropriate panel while wide tables may scroll inside their container

### Requirement: Accessible state and comparison actions
The system SHALL expose keyboard navigation, visible focus, semantic tables, accessible names, non-color status text, and reduced-motion behavior. Progress SHALL reflect actual backend state.

#### Scenario: Keyboard user requests review
- **WHEN** the user navigates the disagreement view with a keyboard
- **THEN** both results, differences, evidence, review, and cancellation actions are available with predictable focus

### Requirement: Capability-aware browser push
The system SHALL detect browser push support and permission, explain unavailable or additional setup states, and SHALL NOT silently enable another disabled notification channel.

#### Scenario: Browser cannot subscribe to push
- **WHEN** push is unsupported or permission is denied
- **THEN** the workspace explains the state and preserves the user's independent email preference
