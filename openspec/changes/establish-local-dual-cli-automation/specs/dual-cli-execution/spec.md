## ADDED Requirements

### Requirement: Subscription CLI adapters without LLM API fallback
The system SHALL execute Claude Code and Codex as authenticated owner-account CLI processes using the current subscriptions. It SHALL NOT inject LLM API billing credentials or silently use another provider/account when execution fails.

#### Scenario: CLI account is unavailable
- **WHEN** either CLI is missing, unauthenticated, out of quota, or incompatible
- **THEN** the affected execution stops with a specific error and no fallback generation

### Requirement: Immutable shared inputs and fresh sessions
The system SHALL provide each independent execution with the same confirmed task plan and captured source manifest and SHALL use fresh sessions without the other CLI's output or previous conversation state.

#### Scenario: Initial or user-requested review round
- **WHEN** a pair of CLI processes is started for that round
- **THEN** both input manifests match and each process executes once
- **AND** only the comparison stage receives both results

### Requirement: Validated structured outputs
The system SHALL validate CLI output schema, manifest identity, evidence references, typed values, and process exit status before comparison. It SHALL record safe execution metadata and SHALL NOT automatically request model repair after malformed output.

#### Scenario: CLI emits malformed JSON
- **WHEN** a CLI response violates the required output contract
- **THEN** execution stops as OUTPUT_SCHEMA_INVALID and is not labeled a successful comparison

### Requirement: Process and data isolation
The system SHALL restrict CLI work to the current task data, prevent access to other users' files and host administration interfaces, and prevent arbitrary shell, source mutation, or unapproved external transmission through model tool requests.

#### Scenario: Source text contains a malicious instruction
- **WHEN** source content instructs the model to read another user's files or send data elsewhere
- **THEN** it is treated as untrusted task data and the action is blocked
- **AND** failure to verify the isolation boundary prevents declaring that capability ready
