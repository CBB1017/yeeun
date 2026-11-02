# Project implementation handoff

The user assigned product implementation to Claude. Read the OpenSpec change at `openspec/changes/establish-local-dual-cli-automation/CLAUDE_HANDOFF.md` first, followed by its linked current requirements, contracts, and tasks. No product application code exists yet; only a verified Compose PostgreSQL/tooling foundation is present.

Preserve the user's requirements: invitation-only Google users, explicitly selected Drive files, owner subscription CLI execution without LLM API fallback, immutable originals, independent same-source runs, bounded user-requested review, per-user round robin, configurable retained local files, and Docker Compose-first Linux containers. Research deadlines are an example task, not a fixed product workflow.

Historical `decisions*.md` do not override the canonical proposal/specs and linked implementation documents. Record implementation/validation in tasks.md. Do not claim live integrations work based only on mocks. Never commit or print credentials or retained user files.
