# Next Steps

Date: 2026-06-02

Read this when choosing the next protocol stability or performance batch. The
best next task should be one coherent runtime delta or one focused proof slice,
not a broad cleanup pass.

## Start Point

- Start with the active risks in [`status.md`](status.md). Use
  [`../AUDIT.md`](../AUDIT.md) as the original risk inventory, not as the
  current status source.
- If a branch already has runtime changes, run or inspect the focused tests
  listed in the relevant slice before selecting new scope.
- Before editing runtime code, write a compact scope in the active slice:
  source files, protocol surface, durable mutation or read path, revision/event
  behavior, rollback or resync behavior, and proof command.

## Current Best Targets

All original numbered-phase implementation slices are implemented. The
2026-06-02 active-risk analysis added candidate measurement slices for the
remaining performance risks; use
[`active-risk-analysis.md`](active-risk-analysis.md) for the evidence and
[`latest-verification.md`](latest-verification.md) for the most recent
maintained verification.

Prefer one of these next:

1. Run the Phase 2 candidate
   [`generation-prompt-construction-pass-measurement.md`](phases/slices/phase-2-command-write-cost/generation-prompt-construction-pass-measurement.md)
   to split prompt assembly timing by load/construction phase before changing
   runtime behavior.
2. Run a Phase 3 candidate only after diagnostics show a concrete expensive
   fallback or fanout workflow:
   [`sprawling-resource-full-bootstrap-measurement.md`](phases/slices/phase-3-read-projection-efficiency/sprawling-resource-full-bootstrap-measurement.md)
   or
   [`asset-byte-fanout-measurement.md`](phases/slices/phase-3-read-projection-efficiency/asset-byte-fanout-measurement.md).
3. Run the Phase 5 candidate
   [`ordinary-risu-export-materialization.md`](phases/slices/phase-5-import-export-asset-memory/ordinary-risu-export-materialization.md)
   only after export-size or memory evidence justifies a streaming-compatible
   `.risu` encoder.
4. Refresh [`latest-verification.md`](latest-verification.md) after the next
   full or focused verification run.

## Not First

- Do not start a full sync-model rewrite; this plan preserves the current
  bootstrap, projection, command, revision, and event model.
- Do not implement server-restart survival for in-flight provider streams
  without a separate durable stream contract.
- Do not add a generic global rate limit as a substitute for route-local
  operational decisions.
- Do not widen plugin, local tool, browser effect, or unsupported generation
  behavior as part of protocol performance work.

## Selection Order

1. Phase 2 prompt-construction measurement.
2. Measured narrow Phase 3 or Phase 5 work with a candidate slice.
3. Additional route schemas only when touching a stable route envelope.
4. Refresh [`latest-verification.md`](latest-verification.md) after the next
   full or focused verification run.

## Proof Commands

Use the smallest focused command first, then broaden only when the change
touches shared protocol behavior.

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm api:test -- server/fastify/__tests__/db.test.ts`
- `pnpm test -- src/lib/Others/projectionGuard.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/backups.test.ts src/ts/server/bootstrap.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
- `pnpm test -- src/ts/process/request/tests/serverChat.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/routeProtection.test.ts`
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
