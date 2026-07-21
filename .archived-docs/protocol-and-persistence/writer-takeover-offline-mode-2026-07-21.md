# Writer Takeover And Offline Mode

> Archived completion and decision record. This describes the named commits
> and their verification state on 2026-07-21, not the current active-writer
> protocol.

Status: completed on the `fastify` branch on 2026-07-21 in commit `99ace5424`.
Only affected suites and typechecks ran before that commit; the full
`test:all`, browser-smoke lane, and live two-client takeover drive did not.
Follow-up commit `6bc1f3bdf` fixed the lost-writer-latch test breakage diagnosed
later the same day.

## Settled Protocol

The server publishes writer ownership on `GET /api/v1/events` as a dedicated
`writer` SSE frame with `{ sessionId, epoch }`. A subscriber gets one initial
frame with current ownership, followed by frames only when ownership actually
changes.

This deliberately uses the separate live-only bus in
`server/fastify/src/writerEvents.ts`, not the command-event sink. Command events
require revisions, and an unknown resource causes the client to fall back to a
full refresh.

The client treats either a writer frame naming a foreign session or any HTTP
423 as loss of writer access. The frame is the primary path; 423 is the race or
disconnect fallback. Idempotent `enterWriterTakeoverFlow()` latches writer
loss, makes server commands and events unavailable, stops SSE plus translation,
reattach, and hydration pollers, and opens a non-dismissible alert.

## Offline Experience And Recovery

The alert offers two choices:

- **Refresh** reloads the app and reacquires ownership because bootstrap latches
  the last writer.
- **Stay offline** applies the `risu-offline-frozen` UI state, a read-only sweep
  and MutationObserver, and a fixed Refresh banner. The CSS disables pointer
  events only on interactive controls while preserving text selection. A
  blanket pointer-event block was rejected because selecting text is the main
  purpose of staying offline.

Refresh is the only exit. Reload-only recovery was chosen for reliability and
to avoid side effects.

Pending-mutation recovery and database-lineage changes still force reload. A
stale tab has lost rollback closures, and an old database lineage is gone, so
remaining offline is unsafe in those flows. No outbox change was required:
`preparePendingMutationOutbox` quarantines rejected-writer drafts on the next
bootstrap.

Background autosave was intentionally not given special handling. Once the
writer frame is received, later writes are already blocked.

## Validation And Test Isolation

The original focused verification had 196 frontend and 21 server tests passing,
with `pnpm check` and `pnpm check:server` clean. The broader validation lanes
listed in the status were not run before commit.

The writer-loss latch is process-global and has no production reset. A test
that simulates a 423 can therefore disable server commands in every later test
sharing the module. Follow-up `6bc1f3bdf` added
`resetWriterAccessLostForTests()` to setup and completed the missing mock export;
future 423 tests must use that reset.
