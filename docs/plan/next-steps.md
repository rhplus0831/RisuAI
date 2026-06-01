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

Phase 1 is implemented. Phase 2 has measured and narrowed the hot command
families: settings/chat/plugin-storage commands use message-free mutation, and
message history plus `generation.persisted` use targeted SQLite paths. Phase 3
has implemented targeted projection, asset metadata indexing, and bulk all-chat
hydration. Phase 4 has implemented bounded slow-consumer behavior for
command/memory SSE, inline and durable chat generation SSE, proxy WebSocket
stream jobs, generation reattach probes after active-chat projection changes
and full resyncs, server-owned resend-cycle caps, and SQLite-backed
finalization retry. Phase 5 has completed the server-owned revision bump audit.

Prefer one of these next:

1. Measure and scope remaining generation/prompt-assembly whole-corpus passes
   only if a narrow side-effect batch can name source files, durable mutation
   behavior, event behavior, rollback behavior, and proof command.
2. Add optional bulk lorebook read reduction only if `enableLorebookStubs`
   workflows become active:
   [`bulk-chat-lorebook-reads.md`](phases/slices/phase-3-read-projection-efficiency/bulk-chat-lorebook-reads.md).
3. Continue Phase 5 with server-owned event atomicity if prioritizing protocol
   correctness:
   [`server-owned-event-atomicity.md`](phases/slices/phase-5-import-export-asset-memory/server-owned-event-atomicity.md).
4. Continue Phase 5 with import/export memory pressure if prioritizing large
   save performance:
   [`expanded-import-size-limits.md`](phases/slices/phase-5-import-export-asset-memory/expanded-import-size-limits.md) or
   [`bundle-export-streaming.md`](phases/slices/phase-5-import-export-asset-memory/bundle-export-streaming.md).

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
3. Server-owned event atomicity, import/export, and asset memory/durability work
   in Phase 5.
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
- `pnpm client-thinning:audit`
- `pnpm api:test`
