## ADDED Requirements

### Requirement: Pluggable source providers
The system SHALL resolve task sources through a provider abstraction covering prompt uploads, Google Drive, and OneDrive in version 1.0. Each provider SHALL supply identity, metadata, enumeration, and immutable byte capture for the user's own authorized targets. Additional cloud providers SHALL be addable through the same abstraction without changing the task model.

#### Scenario: Task mixes sources
- **WHEN** a confirmed task targets an uploaded file and a OneDrive folder
- **THEN** both are captured through their providers into one frozen run manifest
- **AND** each captured file records its provider, identity, version information, and hash

### Requirement: Prompt attachments are retained task originals
The system SHALL let a user attach files to a natural-language request and SHALL store each uploaded file as an immutable task original owned by that user. Uploaded originals SHALL remain available for reruns and schedules until the user explicitly deletes them, and SHALL NOT be removed by per-run snapshot cleanup.

#### Scenario: Scheduled task uses an attachment
- **WHEN** a recurring task was created from an attached file and its next occurrence runs
- **THEN** the run captures the same retained original
- **AND** completing the run deletes only that run's raw snapshot, not the retained original

#### Scenario: User deletes an attachment still used by a task
- **WHEN** the user asks to delete an uploaded original referenced by an active task
- **THEN** the system shows the dependent tasks and requires explicit confirmation before deleting it or pausing those tasks

### Requirement: OneDrive user-selected targets
The system SHALL support connecting a user's Microsoft account and authorizing OneDrive files or folders that the user explicitly selects. Discovery and content access SHALL be limited to those selected targets, and sign-in to the application SHALL NOT imply OneDrive access.

#### Scenario: OneDrive file not selected
- **WHEN** a request mentions a OneDrive file the user has not selected
- **THEN** the system does not retrieve that file and asks the user to select it

### Requirement: Folder targets enumerate current contents recursively
The system SHALL allow a selected folder as a task target. On every run, including scheduled runs, it SHALL enumerate the folder's current contents including subfolders, capture each supported file, and freeze the enumeration in the run manifest. Both independent executions and any second-round review SHALL use that same frozen capture.

#### Scenario: File added to a folder between runs
- **WHEN** a new file is added to a target folder before the next scheduled run
- **THEN** the next run includes the new file
- **AND** a review of an earlier run still uses that earlier run's captured file set

### Requirement: No silent omission from folder captures
The system SHALL list every enumerated file that was not analyzed, with the reason (unsupported format, per-file size limit, access denied), in the run status and result. When total file count or size exceeds the configured run limits, the run SHALL stop with an explicit error instead of analyzing a partial set.

#### Scenario: Folder contains an unsupported file
- **WHEN** a target folder contains a file type the parsers do not support
- **THEN** the result lists that file as not analyzed with its reason
- **AND** the remaining supported files are analyzed

#### Scenario: Folder exceeds run limits
- **WHEN** a target folder's files exceed the configured run file-count or byte limit
- **THEN** the run fails with a limit error and no partial result is presented as complete

### Requirement: Natural-language Drive discovery
The system SHALL let a user find Google Drive files from a natural-language request by searching the user's own Drive by file name and type with read-only access the user consented to. Search SHALL return candidates only and SHALL NOT analyze or bind any file by itself.

#### Scenario: Request names a file the user has not added yet
- **WHEN** a request mentions a research Excel file that is not in the user's authorized list
- **THEN** the system shows matching Drive candidates with name, type, modified time, and folder
- **AND** no candidate is analyzed before confirmation

### Requirement: Confirm discovered files before use
The system SHALL register a discovered Drive file as an authorized source only after the user confirms that candidate. If read-only access was not granted, the system SHALL report that search needs reconnecting and keep manual Picker selection available.

#### Scenario: User confirms one candidate
- **WHEN** the user confirms one of several Drive candidates
- **THEN** only that file becomes an authorized source for the task

#### Scenario: Read-only access was declined
- **WHEN** the user's Drive connection lacks read-only access
- **THEN** search is reported as unavailable with a reconnect option and no other access path is used
