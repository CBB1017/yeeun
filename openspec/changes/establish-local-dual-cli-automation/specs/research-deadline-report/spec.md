## ADDED Requirements

### Requirement: Scheduled research deadline report
WHEN the user requests this research-deadline task and schedule, the system SHALL analyze the university research-project Excel file resolved from the user's natural-language request in Google Drive at 10:00 and 14:00 on Monday through Thursday and deliver the list of projects whose deadline dates fall between the run's start date and start date plus 29 days, inclusive. These task parameters SHALL NOT be imposed on other requests.

#### Scenario: Scheduled run
- **WHEN** a configured Monday-through-Thursday reporting time is reached
- **THEN** the file resolved from the user's request is analyzed for research deadlines in the inclusive 30-date window
- **AND** the result passes through the independent execution and comparison workflow before successful delivery

#### Scenario: November first date window
- **WHEN** the reporting start date is November 1
- **THEN** the date window includes November 1 through November 30

#### Scenario: November second date window
- **WHEN** the reporting start date is November 2
- **THEN** the date window includes November 2 through December 1

### Requirement: No required fixed file link
The system SHALL support resolving the source file from the user's natural-language prompt without requiring a fixed file URL as input.

#### Scenario: User describes a source file
- **WHEN** the user describes the research-project Excel file in their prompt
- **THEN** the system searches within that user's authorized Drive access for the source file

### Requirement: Preserve source table headers
The system SHALL present matching records as a table using the source Excel headers and row format.

#### Scenario: Matching projects exist
- **WHEN** matching projects are returned successfully
- **THEN** the user receives a table retaining the source headers and the corresponding record values

### Requirement: Refresh the selected recurring source
The system SHALL bind a recurring task to the initially selected file identity and retrieve its current contents on each scheduled run. Both LLM executions within that run SHALL receive the same captured version.

#### Scenario: Bound file is edited before a scheduled run
- **WHEN** the user edits the selected file and the next scheduled run begins
- **THEN** the run reads the updated contents of that same file
- **AND** does not repeat natural-language discovery to substitute a different file

#### Scenario: Bound file cannot be accessed
- **WHEN** the selected file is unavailable or its access is revoked
- **THEN** the system does not silently replace it with a different matching file
