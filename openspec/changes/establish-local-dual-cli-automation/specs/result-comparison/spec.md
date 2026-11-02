## ADDED Requirements

### Requirement: Independent initial execution
The system SHALL submit the user's prompt separately to Claude Code and Codex and obtain one initial result from each before comparison.

#### Scenario: Initial request
- **WHEN** a task is submitted for execution
- **THEN** each tool receives the prompt separately and its result is retained for comparison

### Requirement: Compare and organize results
The system SHALL assign the same LLM to comparison and final organization for a task. The assignee SHALL alternate per user between Claude Code and Codex using persistent round-robin state, starting with Claude Code. The next assignment SHALL advance after successful completion; a failed or unresolved task SHALL NOT consume a successful turn.

#### Scenario: Results are available
- **WHEN** both executions complete successfully
- **THEN** the comparison stage evaluates both results before returning an organized result

#### Scenario: First and next successful assignments
- **WHEN** a new user completes their first task successfully
- **THEN** Claude Code performs comparison and final organization for that task
- **AND** that user's next assignment is Codex

#### Scenario: Failed task
- **WHEN** a task fails or remains unresolved
- **THEN** that user's next round-robin assignment is not advanced by that failure

### Requirement: Shared source version and code verification
The system SHALL provide both initial executions with the same captured source version and perform code-based verification of applicable date and numeric operations.

#### Scenario: Research deadline results are checked
- **WHEN** two results for a research deadline report are compared
- **THEN** both are associated with the same captured source version
- **AND** date-window filtering is also verified by code

### Requirement: Semantic agreement and verification failures
The system SHALL treat differently worded results as agreeing when their material facts, numbers, target records, and supporting evidence agree. A numeric mismatch or failed code verification SHALL stop finalization and be displayed as disagreement.

#### Scenario: Wording differs without material differences
- **WHEN** both results have matching facts, numbers, target records, and evidence but use different prose
- **THEN** the comparison may report agreement

#### Scenario: Numeric or verification failure
- **WHEN** numbers disagree or code verification fails
- **THEN** finalization stops and the outcome is shown as disagreement

### Requirement: User-directed review after disagreement
The system SHALL show the first disagreement and the available response actions to the user. Re-execution SHALL require the user's review request.

#### Scenario: User requests review
- **WHEN** the first comparison reports a disagreement and the user requests review
- **THEN** both tools execute again with the original task and only the fact of disagreement added as review feedback
- **AND** neither tool is given the other tool's answer or the disputed values as review feedback

### Requirement: Review the original captured source
The system SHALL reuse the original execution's captured source when the user requests review after disagreement. It SHALL NOT refresh the source during that review.

#### Scenario: Source is edited before review
- **WHEN** the Drive file changes after the initial execution and the user requests disagreement review
- **THEN** both tools review the original captured version
- **AND** the edited Drive version does not replace the original review source

### Requirement: Second disagreement notification
The system SHALL send an error email and a notification when the second comparison still reports disagreement.

#### Scenario: Review results still disagree
- **WHEN** the user-requested second execution is compared and still disagrees
- **THEN** an error email and a notification are sent
- **AND** the outcome is represented as unresolved disagreement

### Requirement: Immediate execution error reporting
The system SHALL immediately report usage-limit, API, network, HTTP 500, internal, and other execution errors to the user and stop the affected task without automatic retry, rather than treating these errors as answer disagreement.

#### Scenario: Execution or comparison fails
- **WHEN** a usage-limit, API, network, HTTP 500, internal, or other execution error is detected
- **THEN** the error is immediately reported to the user and the affected task stops without automatic retry
