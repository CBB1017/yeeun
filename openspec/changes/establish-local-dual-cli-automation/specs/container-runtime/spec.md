## ADDED Requirements

### Requirement: Compose-first Linux container runtime
The system SHALL provide Docker Compose configuration as the standard way to build and run the web service, local execution worker, and PostgreSQL. Containerized services SHALL support a Windows Docker Desktop Linux engine and subsequent migration to a Linux host without Windows-specific application paths.

#### Scenario: Run on Windows or Linux
- **WHEN** the operator starts the completed application with Docker Compose on a supported Linux container engine
- **THEN** web, worker, and database run through the Compose deployment

### Requirement: Persist storage and authentication independently of containers
The system SHALL retain PostgreSQL data, retained local files, and required CLI subscription authentication across ordinary container recreation. Credentials SHALL NOT be baked into images or committed to version control. Container authentication SHALL use account login rather than silently enabling an LLM API billing path.

#### Scenario: Worker container is recreated
- **WHEN** the worker is recreated during an ordinary application update
- **THEN** retained files and persisted authentication remain available unless the operator explicitly removed or revoked them

### Requirement: Host-backed configurable file storage
The system SHALL map the configured host storage root, defaulting to project-root `file`, into container storage. Changing to an unmounted host path SHALL require an operator-managed mount update rather than granting the web application control of the Docker daemon.

#### Scenario: Change the host storage root
- **WHEN** an administrator selects a host directory outside the current mounted storage
- **THEN** configuration indicates the required mount update and service recreation
- **AND** does not silently claim the directory is accessible
