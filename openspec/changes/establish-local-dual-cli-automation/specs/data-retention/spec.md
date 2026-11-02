## ADDED Requirements

### Requirement: Delete source snapshots after successful response
The system SHALL delete temporary source snapshots after delivering a successful final response. The source file in Google Drive SHALL remain unchanged.

#### Scenario: Successful final response is delivered
- **WHEN** a successful final response is delivered to the user
- **THEN** temporary source snapshots are deleted
- **AND** this cleanup does not delete the original Drive file

### Requirement: Durable completion boundary
The system SHALL treat the final response as complete only after validated results, evidence, and requested downloads are durably stored, authorized for web access, and committed with notification intent. Email or push reading SHALL NOT be required, and delivery failure SHALL NOT rerun the analysis or undo its round-robin advancement.

#### Scenario: Successful analysis but failed email delivery
- **WHEN** the final web result is durably available and its email notification fails
- **THEN** the result remains completed with a separate delivery failure
- **AND** raw snapshot cleanup may proceed while retained result and evidence remain available

### Requirement: Retain unresolved and error results
The system SHALL retain results for errored or ongoing-review tasks in the local database and keep a separate copy under a local filesystem location. The database SHALL record the local copy's path.

#### Scenario: Task remains in error or review
- **WHEN** an error or user review leaves a task unresolved
- **THEN** available results remain in the local database
- **AND** a separate local copy is retained with its path recorded in the database

### Requirement: Retain original snapshots during error and review
The system SHALL retain the first execution's original snapshot while a task is in error or awaiting/under review. Snapshot cleanup SHALL wait until final response completion.

#### Scenario: Initial error or disagreement is reported
- **WHEN** an error notification or disagreement report is shown while the task remains unresolved
- **THEN** the original snapshot remains available for review
- **AND** that interim notification does not trigger snapshot deletion

### Requirement: Keep results and evidence
The system SHALL retain successful results and generated downloadable files without automatic expiry. Deleting temporary original snapshots SHALL preserve analyzed version metadata, source locations, and evidence excerpts/previews needed by the evidence panel.

#### Scenario: Original snapshot is cleaned up
- **WHEN** the completed task's original snapshot is deleted
- **THEN** results, generated files, version identity, source locations, and retained evidence remain available

### Requirement: Configurable local storage root
The system SHALL allow the administrator to configure the local storage root and SHALL default to the `file` directory under the project root. Local copy paths SHALL be recorded in the database with enough storage-root context to resolve them after a host or container migration.

#### Scenario: Default storage location
- **WHEN** no custom storage root is configured
- **THEN** host-side retained copies are stored under the project's `file` directory
