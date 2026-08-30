# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-31

## Current Task

Execute the [normal model consumer
cutover](phases/slices/phase-2-model-configuration-ownership/normal-model-consumer-cutover.md).

1. Replace Anthropic thinking, DeepSeek thinking/reasoning, and V2 plugin
   post-parameter reads with the resolved profile runtime values so stale flat
   settings cannot overwrite the canonical sampler projection.
2. Preserve flat behavior only when no resolved profile is present and retain
   the explicitly classified separate-parameter compatibility branch.
3. Continue replacing ordinary runtime reads of flat CBS, translation, agent,
   and auxiliary settings with resolved durable-profile inputs; browser inlay,
   Fastify server-intent completion, and shared request samplers are canonical.
4. Preserve the named clone-only selected-preset seam for legacy inline
   credentials; canonical preset owner fields must continue to win.
5. Prove provider/model/options/fallback parity in browser reload and request
   lanes while retaining explicit legacy conversion/import/export.
6. Isolate the remaining legacy-reader removal and prepare the Phase 2
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
to Workstream 3 while retaining the Phase 5 inline-secret repair holds.
