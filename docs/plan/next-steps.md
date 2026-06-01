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

Phase 1 is implemented. Phase 2 has measured the hot command families, migrated
`settings.updated` plus plugin-storage commands to message-free mutation paths,
and moved `message.appended` to a targeted SQLite message append path. Phase 3
has implemented the targeted-projection, asset metadata, and bulk all-chat
hydration optimizations.

Prefer one of these next:

1. Select the next measured command family, likely generation persistence or a
   second chat/message targeted path such as chat metadata or message
   edit/delete/replace, only after writing a narrow slice with source files,
   durable mutation behavior, event behavior, and proof command.
2. Add optional bulk lorebook read reduction only if `enableLorebookStubs`
   workflows become active:
   [`bulk-chat-lorebook-reads.md`](phases/slices/phase-3-read-projection-efficiency/bulk-chat-lorebook-reads.md).
3. If no command/read slice is active, start Phase 4 with SSE backpressure or
   generation reattach trigger coverage.

The command-family evidence lives in
[`command-family-measurement.md`](phases/slices/phase-2-command-write-cost/command-family-measurement.md).
The implemented Phase 2 migrations are:
[`scoped-settings-mutation-path.md`](phases/slices/phase-2-command-write-cost/scoped-settings-mutation-path.md),
[`scoped-plugin-storage-mutation-path.md`](phases/slices/phase-2-command-write-cost/scoped-plugin-storage-mutation-path.md),
and the `message.appended` batch in
[`message-chat-targeted-persistence.md`](phases/slices/phase-2-command-write-cost/message-chat-targeted-persistence.md).

## Not First

- Do not start a full sync-model rewrite; this plan preserves the current
  bootstrap, projection, command, revision, and event model.
- Do not implement server-restart survival for in-flight provider streams before
  fixing frame replay and finalization durability.
- Do not add a generic global rate limit before completing the route-specific
  inventory, streaming exclusions, and body parser review.
- Do not widen plugin, local tool, browser effect, or unsupported generation
  behavior as part of protocol performance work.

## Selection Order

1. Next measured whole-corpus command-family reduction in Phase 2.
2. Optional Phase 3 lorebook bulk reads or full-resync budgets if measurement
   makes them active.
3. Stream slow-consumer, reattach, resend, and finalization resilience in
   Phase 4.
4. Import/export and asset memory/durability work in Phase 5.
5. Client loop suppression and command write coalescing in Phase 6.
6. Route operation safeguards and manifest coverage in Phase 7.
7. Verification budgets and latest-check recording in Phase 8.

## Proof Commands

Use the smallest focused command first, then broaden only when the change
touches shared protocol behavior.

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm test -- src/lib/Others/projectionGuard.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/backups.test.ts src/ts/server/bootstrap.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm client-thinning:audit`
- `pnpm api:test`
