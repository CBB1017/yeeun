## ADDED Requirements

### Requirement: Preserve source files and create copies
The system SHALL preserve original source files and perform requested transformations on new output copies. It SHALL support downloadable generated files in addition to web responses.

#### Scenario: User requests changes to spreadsheet data
- **WHEN** the user asks to modify the data and generate a result file
- **THEN** the requested changes appear in a new downloadable copy
- **AND** the original source file is not modified or deleted

### Requirement: Confirm external transmission
The system SHALL require user confirmation before externally transmitting generated outputs. Previously authorized report and error notifications SHALL follow their configured delivery rules.

#### Scenario: Send a generated copy externally
- **WHEN** a task proposes sending a generated copy to an external destination
- **THEN** transmission waits for confirmation of the output and destination
- **AND** the original source remains unchanged
