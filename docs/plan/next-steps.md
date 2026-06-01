# Next Steps

Date: 2026-06-01

Read this when choosing the next protocol stability or performance batch. The
best next task should be one coherent runtime delta or one focused proof slice,
not a broad cleanup pass.

## Start Point

- Start with the active risks in [`status.md`](status.md) and the confirmed
  findings in [`../AUDIT.md`](../AUDIT.md).
- If a branch already has runtime changes, run or inspect the focused tests
  listed in the relevant slice before selecting new scope.
- Before editing runtime code, write a compact scope in the active slice:
  source files, protocol surface, durable mutation or read path, revision/event
  behavior, rollback or resync behavior, and proof command.

## Current Best Targets

Phases 1 and 4 are implemented. Phase 2 narrowed the measured hot command
families: settings/chat/plugin-storage commands use message-free mutation, and
message history plus `generation.persisted` use targeted SQLite paths. Phase 3
has targeted projection, asset metadata indexing, and bulk all-chat hydration.
Phase 5 has completed revision/event atomicity, expanded import limits, and
bundle export streaming, plus per-generation asset caching; remaining Phase 5
work is broader asset-file durability.

Prefer one of these next:

1. Measure and scope remaining generation/prompt-assembly whole-corpus passes
   only if a narrow side-effect batch can name source files, durable mutation
   behavior, event behavior, rollback behavior, and proof command.
2. Add optional bulk lorebook read reduction only if `enableLorebookStubs`
   workflows become active:
   [`bulk-chat-lorebook-reads.md`](phases/slices/phase-3-read-projection-efficiency/bulk-chat-lorebook-reads.md).
3. Continue Phase 5 asset work if prioritizing file-backed recovery:
   [`asset-mutation-transaction-protocol.md`](phases/slices/phase-5-import-export-asset-memory/asset-mutation-transaction-protocol.md).

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

## Not First

- Do not start a full sync-model rewrite; this plan preserves the current
  bootstrap, projection, command, revision, and event model.
- Do not implement server-restart survival for in-flight provider streams
  without a separate durable stream contract.
- Do not add a generic global rate limit before completing the route-specific
  inventory, streaming exclusions, and body parser review.
- Do not widen plugin, local tool, browser effect, or unsupported generation
  behavior as part of protocol performance work.

## Selection Order

1. Narrow generation/prompt side-effect work in Phase 2 only when a measured
   slice is available.
2. Optional Phase 3 lorebook bulk reads or full-resync budgets if measurement
   makes them active.
3. Remaining asset durability work in Phase 5.
4. Client loop suppression and command write coalescing in Phase 6.
5. Route operation safeguards and manifest coverage in Phase 7.
6. Verification budgets and latest-check recording in Phase 8.

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
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
