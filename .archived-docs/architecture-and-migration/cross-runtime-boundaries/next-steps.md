# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

This workstream is complete. There is no remaining implementation slice.

Ongoing enforcement is automatic:

- `pnpm check:server` rejects new cross-runtime imports, non-literal references,
  project references, and shared-package boundary violations.
- New wire contracts must use explicit `@risuai/protocol` subpaths.
- New framework-neutral shared behavior must pass the shared-core import and
  ownership audits.
- Workstream 2 owns compatibility/repair/interchange decisions; Workstream 3
  owns remaining browser resource consumers and bridge retirement.
