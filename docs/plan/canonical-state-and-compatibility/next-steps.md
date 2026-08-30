# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-30

## Current Task

Execute the [legacy flat model configuration
migration](phases/slices/phase-2-model-configuration-ownership/legacy-flat-model-configuration-migration.md).

1. Audit flat model/provider fields, role selections, durable profiles/bindings,
   and every normal resolver consumer.
2. Add one named transactional migration that creates stable canonical records
   only from usable non-secret legacy state.
3. Prove provider/model/options/fallback parity across migration, interruption,
   retry, reopen, authoring, import, and export.
4. Keep explicit legacy conversion/import supported while preventing flat
   fields from remaining normal runtime owners.
5. Leave inline-secret repair for Phase 5 and preserve credential masking.

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

After the flat migration passes, update [`status.md`](status.md), refresh
[`latest-verification.md`](latest-verification.md), and continue Phase 2 by
moving remaining normal model consumers to the durable owner.
