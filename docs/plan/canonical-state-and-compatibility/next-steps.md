# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-31

## Current Task

Execute the [normal model consumer
cutover](phases/slices/phase-2-model-configuration-ownership/normal-model-consumer-cutover.md).

1. Inventory every normal authoring, reload, generation, memory, translation,
   scripting, tool, agent, and auxiliary resolver consumer.
2. Route normal consumers through durable role bindings and profile records.
3. Prevent normal authoring from restoring flat model/runtime ownership.
4. Prove provider/model/options/fallback parity in browser reload and request
   lanes while retaining explicit legacy conversion/import/export.
5. Isolate the remaining legacy-reader removal and prepare the Phase 2
   model-owner release cursor for Workstream 3.

## Phase 0 Release

`1e758cd22` adds the named transactional runner checks, test-only interruption
proof, damaged-database refusal, and 19-surface fixture adapter required by the
Phase 0 dispositions.

## Not In This Slice

- Do not migrate prompt or translator mirrors yet.
- Do not remove a compatibility reader, exporter, table, field, or route.
- Do not turn legacy conversion or damaged-state repair into an implicit normal
  command.
- Do not remove a Workstream 3 bridge for any resource family.

## Handoff

After normal consumers pass, isolate and remove the ordinary legacy resolver
fallback, refresh the Phase 2 release evidence, and hand the model-owner cursor
to Workstream 3 while retaining the Phase 5 inline-secret repair hold.
