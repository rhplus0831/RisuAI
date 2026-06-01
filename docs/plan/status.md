# Server/Client Protocol Stability And Performance Status

Date: 2026-06-01

This is the status router for the Fastify server/client protocol stability and
performance workstream. Use it first, then open only the phase or slice needed
for the next task.

## Current Snapshot

Completed work:

- Phase 0 foundations are in place: opt-in protocol metrics/diagnostics,
  bounded or aggregated hydration, SQLite command-event replay, and route
  manifest coverage.
- Phase 1 P1 correctness issues are closed: event replay setup races, backup
  restore resync, durable generation frame replay, and guarded UI projection
  writes all have regression coverage.
- Phase 2 has a reproducible command metrics harness. `settings.updated`,
  `chat.updated`, and plugin-storage put/delete/bulk commands use the
  message-free mutation path. `message.appended` uses a targeted SQLite message
  append path. Message edit/delete/truncate/replace commands use targeted
  SQLite message paths, and `generation.persisted` uses a targeted SQLite
  generation message path.
- Phase 3 has six read-side optimizations: targeted projection field selectors
  for empty, small, character-family, mixed broad, and plugin resources; an
  in-process asset metadata index; and authenticated bulk all-chat hydration.
- Phase 4 has bounded slow-consumer behavior for `/api/v1/events`, inline and
  durable chat-generation SSE, and proxy WebSocket stream jobs.

No P1 plan risks remain open after the Phase 1 commits.

Active performance risks:

- Generation and prompt assembly can still perform multiple whole-corpus
  passes around side effects before final targeted persistence.
- Full-bootstrap fallbacks for sprawling resources such as `settings`, `state`,
  and `pluginStorage` remain expensive.
- Asset byte reads remain one request per asset, although metadata lookup is no
  longer reparsed for every lookup.
- Optional lorebook hydration is still N requests when experimental
  `enableLorebookStubs` is enabled.
- Import, export, and bundle paths can materialize large payloads.
- Memory job polling, settings writes, watcher echo, and generation resend
  loops need explicit suppression or caps.

## Start Here

- Use [`next-steps.md`](next-steps.md) to choose the next task.
- Use [`plan.md`](plan.md) for invariants and phase order.
- Use [`phases/README.md`](phases/README.md) for all phase docs.
- With Phase 1 implemented, prefer measured P2 work from
  [`next-steps.md`](next-steps.md).

## Phase Router

| Phase                                                     | Status                               | Open when working on...                                                                 |
| --------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| [Phase 0](phases/phase-0-baseline-foundations.md)         | Implemented foundation, keep current | Existing metrics, hydration bounds/aggregation, durable event history, route manifest.  |
| [Phase 1](phases/phase-1-correctness-hardening.md)        | Implemented                          | Closed P1 correctness hardening.                                                        |
| [Phase 2](phases/phase-2-command-write-cost.md)           | Message history targeted             | Whole-corpus command mutation cost and narrow write paths.                              |
| [Phase 3](phases/phase-3-read-projection-efficiency.md)   | Six optimizations implemented        | Targeted projection, asset metadata reads, bulk read endpoints, full resync budgets.    |
| [Phase 4](phases/phase-4-stream-generation-resilience.md) | Backpressure implemented             | Generation reattach triggers, resend caps, finalization retry.                          |
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
