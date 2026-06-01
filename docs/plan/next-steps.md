# Next Steps

Date: 2026-06-01

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

Phase 0 foundations and Phases 1, 5, 6, 7, and 8 are implemented. Phase 2
narrowed the measured hot command families: settings/chat/plugin-storage
commands use message-free mutation, and message history plus
`generation.persisted` use targeted SQLite paths. Phase 3 has targeted
projection, asset metadata indexing, and bulk all-chat hydration. Phase 4
runtime resilience is implemented; its remaining SSE taxonomy slice is only
needed when chat stream vocabulary changes.

Prefer one of these next:

1. Review the new generation/prompt metrics from
   [`generation-prompt-side-effect-measurement.md`](phases/slices/phase-2-command-write-cost/generation-prompt-side-effect-measurement.md)
   and select one narrow optimization only if the metric output identifies a
   concrete source area, durable mutation behavior, event behavior, rollback
   behavior, and proof command.
2. Add optional bulk lorebook read reduction only if `enableLorebookStubs`
   workflows become active:
   [`bulk-chat-lorebook-reads.md`](phases/slices/phase-3-read-projection-efficiency/bulk-chat-lorebook-reads.md).
3. Add the Phase 4 SSE taxonomy fixture only when touching chat stream event
   names or payload shapes:
   [`sse-taxonomy-alignment.md`](phases/slices/phase-4-stream-generation-resilience/sse-taxonomy-alignment.md).

Latest maintained verification is recorded in
[`latest-verification.md`](latest-verification.md).

The command-family evidence lives in
[`command-family-measurement.md`](phases/slices/phase-2-command-write-cost/command-family-measurement.md).
The implemented Phase 2 migrations are:
[`scoped-settings-mutation-path.md`](phases/slices/phase-2-command-write-cost/scoped-settings-mutation-path.md),
[`scoped-plugin-storage-mutation-path.md`](phases/slices/phase-2-command-write-cost/scoped-plugin-storage-mutation-path.md),
the `chat.updated`, `message.appended`, and message edit/delete/truncate/replace
batches in
[`message-chat-targeted-persistence.md`](phases/slices/phase-2-command-write-cost/message-chat-targeted-persistence.md),
and
[`generation-persistence-narrow-path.md`](phases/slices/phase-2-command-write-cost/generation-persistence-narrow-path.md).
Generation/prompt side-effect measurement lives in
[`generation-prompt-side-effect-measurement.md`](phases/slices/phase-2-command-write-cost/generation-prompt-side-effect-measurement.md).

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

1. Use the generation/prompt metrics to choose one Phase 2 side-effect
   optimization only when the source area and protocol behavior are clear.
2. Optional Phase 3 lorebook bulk reads or full-resync frequency budgets if
   measurement makes them active.
3. SSE taxonomy verification when chat stream vocabulary changes.
4. Additional route schemas only when touching a stable route envelope.
5. Refresh [`latest-verification.md`](latest-verification.md) after the next
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
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
