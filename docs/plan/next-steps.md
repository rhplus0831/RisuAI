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

1. Make backup restore force a trusted resync or apply returned projection:
   [`backup-restore-resync.md`](phases/slices/phase-1-correctness-hardening/backup-restore-resync.md).
2. Make durable generation reattach replay required lifecycle frames:
   [`durable-generation-frame-replay.md`](phases/slices/phase-1-correctness-hardening/durable-generation-frame-replay.md).
3. Remove direct guarded projection writes in the Hypa V3 and bookmark UI paths:
   [`direct-projection-write-fixes.md`](phases/slices/phase-1-correctness-hardening/direct-projection-write-fixes.md).

After those P1 slices, prefer measured P2 work:

- Select the first narrow command family from metrics:
  [`command-family-measurement.md`](phases/slices/phase-2-command-write-cost/command-family-measurement.md).
- Short-circuit empty or small targeted projection resources:
  [`targeted-projection-loaders.md`](phases/slices/phase-3-read-projection-efficiency/targeted-projection-loaders.md).
- Add an asset metadata index or cache:
  [`asset-metadata-index.md`](phases/slices/phase-3-read-projection-efficiency/asset-metadata-index.md).

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

1. P1 correctness slices in Phase 1.
2. Measured whole-corpus command cost in Phase 2.
3. Read-side projection and asset lookup reduction in Phase 3.
4. Stream slow-consumer, reattach, resend, and finalization resilience in
   Phase 4.
5. Import/export and asset memory/durability work in Phase 5.
6. Client loop suppression and command write coalescing in Phase 6.
7. Route operation safeguards and manifest coverage in Phase 7.
8. Verification budgets and latest-check recording in Phase 8.

## Proof Commands

Use the smallest focused command first, then broaden only when the change
touches shared protocol behavior.

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
