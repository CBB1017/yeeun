## ADDED Requirements

### Requirement: User-defined tasks and schedules
The system SHALL create scheduled tasks from the user's requested work and execution schedule. It SHALL NOT impose research analysis, Monday-through-Thursday execution, 10:00/14:00 times, or a holiday exclusion as global application behavior.

#### Scenario: User requests a recurring research analysis
- **WHEN** the user asks to analyze a research-project file Monday through Thursday at 10:00 and 14:00
- **THEN** that task is scheduled to start the requested work at those times
- **AND** those settings do not become defaults or restrictions for unrelated tasks

#### Scenario: User requests another task or time
- **WHEN** the user requests different work or a different execution schedule
- **THEN** the system uses that user's requested work and schedule
- **AND** asks the user to clarify any material ambiguity rather than assigning unspecified schedule rules

### Requirement: Single catch-up after local PC downtime
The system SHALL execute one catch-up run for each scheduled task that missed execution while the owner's local PC was off, when execution becomes available again. Multiple missed occurrences of the same task SHALL be coalesced into one catch-up run.

#### Scenario: Multiple occurrences missed while PC is off
- **WHEN** the owner's PC becomes available after a task missed several scheduled occurrences
- **THEN** one catch-up run executes that task
- **AND** the system does not execute every missed occurrence separately
