## ADDED Requirements

### Requirement: Confirm a user-defined task plan
The system SHALL convert a user's natural-language request into a reviewable plan identifying the work, authorized sources, output formats, schedule/timezone when requested, and notification settings. It SHALL resolve material ambiguities with the user before activating the task and SHALL NOT impose the research example as a global workflow.

#### Scenario: User requests an arbitrary supported task
- **WHEN** a user submits a natural-language request
- **THEN** the system presents the interpreted plan and asks only for unresolved material information
- **AND** execution or scheduling begins only after the user confirms that plan revision

### Requirement: Distinguish authoring from execution
The system SHALL disclose any CLI-assisted planning call as task setup and SHALL NOT treat it as one of the independent task executions or a successful round-robin turn. It SHALL avoid further planning calls for unchanged requests and simple form selections.

#### Scenario: Planning needs a CLI interpretation
- **WHEN** the system uses the assigned CLI to interpret the draft request
- **THEN** the user sees a task-setup stage and its shared-subscription usage implication
- **AND** the eventual confirmed execution still obtains one independent initial result from each CLI

### Requirement: Reject unsupported operations explicitly
The system SHALL report unsupported work or source formats without executing arbitrary host commands or inventing successful results.

#### Scenario: Request requires an unsupported operation
- **WHEN** the request cannot be performed by the supported task tools
- **THEN** the plan states the limitation and does not activate an unsafe or fabricated execution
