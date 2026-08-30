# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-31

## Current Task

Execute the [normal model consumer
cutover](phases/slices/phase-2-model-configuration-ownership/normal-model-consumer-cutover.md).

1. Remove the redundant flat `aiModel` dimension from the LLM translation cache
   signature; the resolved translate-profile signature remains authoritative.
2. Make the Novellist locale heuristic inspect the effective translate role,
   with explicit legacy/static behavior retained where required.
3. Add conflicting chat-main/translate/flat fixtures for cache invalidation and
   locale selection.
4. Continue replacing ordinary runtime reads of flat agent and auxiliary
   settings; CBS, generation labels, plugin loop protection, and
   provider-specific thinking overrides are now canonical.
5. Preserve the named clone-only selected-preset seam for legacy inline
   credentials; canonical preset owner fields must continue to win.
6. Prove provider/model/options/fallback parity in browser reload and request
   lanes while retaining explicit legacy conversion/import/export.
7. Isolate the remaining legacy-reader removal and prepare the Phase 2
   model-owner release cursor for Workstream 3.

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

After normal consumers pass, isolate and remove the ordinary legacy resolver
fallback, refresh the Phase 2 release evidence, and hand the model-owner cursor
to Workstream 3 while retaining the Phase 5 inline-secret repair holds.
