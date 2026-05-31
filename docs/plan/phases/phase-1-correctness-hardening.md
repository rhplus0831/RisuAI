# Phase 1: Correctness Hardening

Status: active priority. Event replay/subscribe race, restore resync, and
durable generation frame replay are implemented; the remaining P1 slice is
direct projection write fixes.

Goal: close the confirmed P1 correctness issues from `docs/AUDIT.md` before
optimizing lower-severity costs.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
- `server/fastify/src/routes/events.ts`
- `server/fastify/src/routes/backups.ts`
- `server/fastify/src/streamJobs.ts`
- `src/ts/process/request/serverChat.ts`
- `src/lib/Others/HypaV3Modal.svelte`
- `src/lib/Others/BookmarkList.svelte`

## Slices

- [`event-replay-subscribe-race.md`](slices/phase-1-correctness-hardening/event-replay-subscribe-race.md)
- [`backup-restore-resync.md`](slices/phase-1-correctness-hardening/backup-restore-resync.md) -
  implemented
- [`durable-generation-frame-replay.md`](slices/phase-1-correctness-hardening/durable-generation-frame-replay.md) -
  implemented
- [`direct-projection-write-fixes.md`](slices/phase-1-correctness-hardening/direct-projection-write-fixes.md)

## Exit Criteria

- Event subscription cannot miss a committed command between replay and live
  fanout.
- Restore updates or refetches the active projection before the browser accepts
  further edits at the restored revision.
- Durable generation reattach always provides the lifecycle frames required by
  the client parser.
- UI paths no longer mutate guarded server-backed projection state directly.

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/backups.test.ts src/ts/server/bootstrap.test.ts`
