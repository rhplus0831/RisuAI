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

Phase 1 P1 correctness hardening is implemented, the first two measured Phase 2
message-free migrations are complete, and the Phase 3 targeted-projection,
asset metadata, and bulk chat hydration optimizations are implemented. Empty,
small, character-family, mixed broad, and plugin targeted projection resources
now have field selectors, and all-chat hydration has a one-request path. Prefer
one of these next:

1. Add optional bulk lorebook read reduction only if `enableLorebookStubs`
   workflows become an active target:
   [`bulk-chat-lorebook-reads.md`](phases/slices/phase-3-read-projection-efficiency/bulk-chat-lorebook-reads.md).
2. Select the next measured command family, likely from chat/message targeted
   persistence or generation persistence, only after writing a narrow slice
   with explicit source area, durable mutation behavior, event behavior, and
   proof command.

The first command-family measurement is complete in
[`command-family-measurement.md`](phases/slices/phase-2-command-write-cost/command-family-measurement.md);
it first selected `settings.updated`, which is now implemented in
[`scoped-settings-mutation-path.md`](phases/slices/phase-2-command-write-cost/scoped-settings-mutation-path.md).
The next measured non-message family, plugin storage, is implemented in
[`scoped-plugin-storage-mutation-path.md`](phases/slices/phase-2-command-write-cost/scoped-plugin-storage-mutation-path.md).

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

1. Measured whole-corpus command cost in Phase 2.
2. Read-side projection and asset lookup reduction in Phase 3.
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
