## ADDED Requirements

### Requirement: Google account sign-in and Drive authorization
The system SHALL support Google OIDC sign-in and user-authorized access to Google Drive through OAuth and the Drive API. External web access SHALL initially use ngrok without requiring the tunnel to allow only the owner's Google account.

#### Scenario: Signed-in user connects Drive
- **WHEN** a signed-in user authorizes Drive access
- **THEN** file operations use that user's authorized Drive access
- **AND** sign-in alone is not treated as permission to read Drive files

### Requirement: User data isolation
The system SHALL associate Drive credentials, jobs, captured files, results, and notification destinations with the corresponding user and prevent another user from accessing them through the application.

#### Scenario: Different users submit requests
- **WHEN** a user requests a file or job through the application
- **THEN** the application enforces that user's authorization rather than using another user's Drive credentials or results

### Requirement: Invited users only
The system SHALL permit application use only by invited users authenticated through Google. Authorized users SHALL share the owner's local Claude Pro and ChatGPT Plus CLI execution capacity in the current version.

#### Scenario: Uninvited Google user
- **WHEN** a Google account without an invitation signs in
- **THEN** the application does not permit access to application data or task execution

### Requirement: User-selected Drive files only
The system SHALL limit Drive discovery and content access to files the user has explicitly authorized for this application. It SHALL NOT request broad Drive read access for natural-language discovery.

#### Scenario: Search includes an unauthorized file
- **WHEN** a user's natural-language query could refer to a file not authorized for the application
- **THEN** the system does not retrieve that file's metadata or contents as part of application search
- **AND** the user can explicitly authorize the desired file through the file authorization flow

### Requirement: Resolve ambiguous file candidates
The system SHALL present matching candidate files for user selection when more than one authorized file matches the request.

#### Scenario: Multiple matching authorized files
- **WHEN** more than one authorized file matches the user's natural-language request
- **THEN** the system asks the user to select the intended file before analyzing it or binding a recurring job

### Requirement: Evidence panel
The system SHALL provide an evidence panel with the captured source location supporting the returned result, including file identity, sheet and cell range for spreadsheets, page for PDFs, slide for presentations, or recognized region for images, as applicable. The panel SHALL include source excerpts or previews and capture/version information.

#### Scenario: User inspects a result row
- **WHEN** the user selects a returned spreadsheet record
- **THEN** the evidence panel shows the captured source row/cells and source identity supporting the record

### Requirement: Show the analyzed file version
The system SHALL show the user which file version was actually analyzed, including source identity and capture time. When a source revision identifier is unavailable, the system SHALL clearly distinguish the retained local snapshot identifier from a provider-issued revision rather than inventing a Drive revision.

#### Scenario: User views an initial or reviewed result
- **WHEN** an analysis result or disagreement review is shown
- **THEN** the analyzed source version and capture time are visible to the user
- **AND** disagreement review identifies the same captured version as the initial analysis
