# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-31

## Current Task

Execute [Phase 3 prompt-template ownership](phases/phase-3-prompt-template-ownership.md)
after the Phase 2 model-owner release at `6020f6009`.

## Phase 0 Release

`1e758cd22` adds the named transactional runner checks, test-only interruption
proof, damaged-database refusal, and 19-surface fixture adapter required by the
Phase 0 dispositions.

## Not In This Slice

- Do not migrate prompt ownership or translator preset persistence in this
  consumer slice.
- Do not remove a compatibility reader, exporter, table, field, or route.
- Do not turn legacy conversion or damaged-state repair into an implicit normal
  command.
- Do not remove a Workstream 3 bridge for any resource family.

## Handoff

Phase 2 model consumers are released to Workstream 3. Retain the named model
static/import/export/compatibility seams and Phase 5 inline-secret repair hold
while Prompt Phase 3 establishes its canonical owner and release evidence.
