# Server/Client Protocol Stability And Performance Status

Date: 2026-06-01

This is the status router for the Fastify server/client protocol stability and
performance workstream. Use it first, then open only the phase or slice needed
for the next task.

## Current Snapshot

Completed foundations:

- Protocol metrics exist behind `RISU_PROTOCOL_METRICS`, and client diagnostics
  exist behind `localStorage.risu:protocol-debug`.
- Bulk chat and lorebook hydration fanout is bounded by
  `BULK_HYDRATION_CONCURRENCY = 4`.
- Command-event history is persisted in SQLite and can replay retained command
  gaps.
- `/api/v1/events` subscribes to command events before selecting replay, queues
  setup-time command events, and drains events not already covered by replay.
- Backup restore now forces a trusted read-only bootstrap resync before the
  browser reports success or advances past the restored projection.
- Durable generation reattach replays required lifecycle frames through a
  durable-only job replay log, including `prompt` and latest `info`.
- Hypa V3 modal and bookmark UI paths avoid direct guarded projection writes in
  Fastify mode.
- `server/fastify/src/routeManifest.ts` drives route protocol ownership,
  active-writer classification, route-protection tests, and the architecture
  audit.
- Phase 2 command-family measurement now has a reproducible metrics harness;
  `settings.updated` uses a message-free mutation path for settings writes.
- Phase 3 targeted projection now short-circuits empty-field resources such as
  `asset`, so no-op projection refreshes advance the client revision cursor
  without loading `db.json` or full stub projection state.

Active correctness risks from [`../AUDIT.md`](../AUDIT.md): none currently
tracked at P1.

Active performance risks:

- Unmigrated JSON commands still pay whole-corpus load, clone, diff, and write
  cost.
- Non-empty targeted projection resources can still load the full stub
  projection before selecting small fields.
- Asset metadata reads can parse `db.json` per asset lookup.
- Import, export, and bundle paths can materialize large payloads.
- Memory job polling, settings writes, watcher echo, and generation resend
  loops need explicit suppression or caps.
- SSE and stream fanout need bounded slow-consumer behavior.

## Start Here

- Use [`next-steps.md`](next-steps.md) to choose the next task.
- Use [`plan.md`](plan.md) for invariants and phase order.
- Use [`phases/README.md`](phases/README.md) for all phase docs.
- With Phase 1 implemented, prefer measured P2 work from
  [`next-steps.md`](next-steps.md).

## Phase Router

| Phase                                                     | Status                               | Open when working on...                                                                 |
| --------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| [Phase 0](phases/phase-0-baseline-foundations.md)         | Implemented foundation, keep current | Existing metrics, bounded hydration, durable event history, route manifest coverage.    |
| [Phase 1](phases/phase-1-correctness-hardening.md)        | Implemented                          | Closed P1 correctness hardening.                                                        |
| [Phase 2](phases/phase-2-command-write-cost.md)           | First migration implemented          | Whole-corpus command mutation cost and narrow write paths.                              |
| [Phase 3](phases/phase-3-read-projection-efficiency.md)   | First optimization implemented       | Targeted projection, asset metadata reads, bulk read endpoints, full resync budgets.    |
| [Phase 4](phases/phase-4-stream-generation-resilience.md) | Planned                              | SSE backpressure, generation reattach triggers, resend caps, finalization retry.        |
| [Phase 5](phases/phase-5-import-export-asset-memory.md)   | Planned                              | Import/export memory pressure, asset mutation durability, per-generation media caching. |
| [Phase 6](phases/phase-6-client-loop-suppression.md)      | Planned                              | Memory job polling, server-origin watcher echo, settings write coalescing.              |
| [Phase 7](phases/phase-7-route-operations-coverage.md)    | Planned                              | Explicit route limits, HEAD/body parser audit, schemas, wildcard manifest coverage.     |
| [Phase 8](phases/phase-8-verification-budgets.md)         | Planned                              | Request, payload, metric, and verification budgets.                                     |

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the navigation entry points.
- Keep phase summaries in `phases/`; keep concrete task scope in
  `phases/slices/[phase]/`.
- Do not treat a phase doc as permission to widen runtime behavior. Re-check
  the code, `../AUDIT.md`, and the relevant structure doc before editing.
- Add a slice before starting a new implementation batch if no existing slice
  names its source area, mutations, event behavior, rollback behavior, and proof
  command.
- Update this status after a phase changes state.
