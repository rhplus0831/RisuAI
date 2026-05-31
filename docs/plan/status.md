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
- `server/fastify/src/routeManifest.ts` drives route protocol ownership,
  active-writer classification, route-protection tests, and the architecture
  audit.

Active correctness risks from [`../AUDIT.md`](../AUDIT.md):

- `/api/v1/events` can miss a command between replay selection and live
  subscription.
- Backup restore can leave the active browser on stale pre-restore projection
  state.
- Durable generation reattach can miss required `prompt` and `info` frames.
- Hypa V3 modal and bookmark UI paths can still attempt direct guarded
  projection writes.

Active performance risks:

- JSON commands still pay whole-corpus load, clone, diff, and write cost.
- Targeted projection can load the full stub projection before selecting small
  resources.
- Asset metadata reads can parse `db.json` per asset lookup.
- Import, export, and bundle paths can materialize large payloads.
- Memory job polling, settings writes, watcher echo, and generation resend
  loops need explicit suppression or caps.
- SSE and stream fanout need bounded slow-consumer behavior.

## Start Here

- Use [`next-steps.md`](next-steps.md) to choose the next task.
- Use [`plan.md`](plan.md) for invariants and phase order.
- Use [`phases/README.md`](phases/README.md) for all phase docs.
- Use [`phases/slices/phase-1-correctness-hardening/`](phases/slices/phase-1-correctness-hardening/)
  first unless a branch already addresses every P1 risk above.

## Phase Router

| Phase                                                     | Status                               | Open when working on...                                                                 |
| --------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| [Phase 0](phases/phase-0-baseline-foundations.md)         | Implemented foundation, keep current | Existing metrics, bounded hydration, durable event history, route manifest coverage.    |
| [Phase 1](phases/phase-1-correctness-hardening.md)        | Active priority                      | Event race, restore resync, generation replay frames, direct projection writes.         |
| [Phase 2](phases/phase-2-command-write-cost.md)           | Planned                              | Whole-corpus command mutation cost and narrow write paths.                              |
| [Phase 3](phases/phase-3-read-projection-efficiency.md)   | Planned                              | Targeted projection, asset metadata reads, bulk read endpoints, full resync budgets.    |
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
