# Canonical State And Compatibility Retirement Next Steps

Date: 2026-08-31

## Current Task

Execute the [normal model consumer
cutover](phases/slices/phase-2-model-configuration-ownership/normal-model-consumer-cutover.md).

1. Thread resolved profile runtime sampling into the browser request parameter
   builder so normal OpenAI, Anthropic, Gemini, Mistral, Cohere, Ooba, and plugin
   adapters cannot read conflicting flat fields.
2. Preserve the explicitly classified separate-parameter compatibility branch
   while moving ordinary calls to the selected profile runtime input.
3. Continue replacing ordinary runtime reads of flat CBS, translation, agent,
   and auxiliary settings with resolved durable-profile inputs; browser inlay
   and Fastify server-intent completion are now canonical.
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
