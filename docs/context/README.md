# Project Context Registry

This directory contains the "source of truth" for the AVISHKAR EMS project state to facilitate faster context loading and token-efficient resumes for future AI/human sessions.

## Contents

- [KNOWN_ISSUES.md](KNOWN_ISSUES.md): Prioritized list of technical and data-related drawbacks.
- [STATUS.md](STATUS.md): The "honest ledger" tracking progress against the project specification.
- [WORKLOG.md](WORKLOG.md): Chronological record of sessions, including what was done, what was not, and concrete next steps.
- [AUDIT_REPORT.md](AUDIT_REPORT.md): Summary of deployment and security audits conducted.

## How to use
- **Always read these files first** upon resuming a session to establish the baseline.
- **Update these files** immediately after any change (e.g., fulfilling a phase, discovering a bug, or performing an audit).
- If you run a new task, document it in `WORKLOG.md` and check `STATUS.md` for consistency.
