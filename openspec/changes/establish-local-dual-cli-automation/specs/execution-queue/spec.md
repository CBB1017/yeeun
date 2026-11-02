## ADDED Requirements

### Requirement: Task-level queue with extensible concurrency
The system SHALL queue tasks and initially process one task at a time. It SHALL keep concurrency policy configurable and separate from task definitions so later multi-task execution does not require changing the task model.

#### Scenario: Another task arrives during execution
- **WHEN** a task is running and another is submitted
- **THEN** the new task waits in the task-level queue

#### Scenario: Concurrency is expanded in a future version
- **WHEN** supported task concurrency is increased
- **THEN** existing task definitions remain valid
- **AND** user data isolation and persistent round-robin requirements still apply

### Requirement: Stop and report execution errors
The system SHALL immediately notify the user and stop the affected task on usage-limit, network, HTTP 500, internal execution, and other execution errors. It SHALL NOT automatically retry the failed execution.

#### Scenario: Execution fails
- **WHEN** either CLI, comparison, or task execution reports an execution error
- **THEN** the affected task stops and the user is immediately notified
- **AND** the system does not automatically rerun it

### Requirement: User lane preserves round-robin order
The system SHALL allow at most one nonterminal execution per user, including review waiting, while allowing other users' eligible work to use the global queue. Waiting for review SHALL release the active global processing slot. Terminal failed, disagreed, cancelled, and interrupted runs SHALL release the user lane while preserving retained data.

#### Scenario: One user awaits review
- **WHEN** that user submits another task while their prior run awaits review
- **THEN** their new run waits with an explanation and review/cancel action
- **AND** eligible tasks from other users can execute

### Requirement: Cancellation and bounded execution
The system SHALL support cancellation and configured timeouts, terminate affected sibling CLI processes, retain available results, and distinguish interrupted active work from missed unstarted schedules.

#### Scenario: Worker dies during an active run
- **WHEN** the worker restarts and finds an expired active-run lease
- **THEN** the run is marked interrupted and is not automatically executed again
