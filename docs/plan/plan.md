# Server/Client Protocol Stability And Performance Plan

Date: 2026-06-01

## Goal

Keep the Fastify server/client protocol correct under reconnects, restores,
generation reattach, large saves, and active browser sessions while reducing
the biggest full-corpus and repeated-read costs.

End state:

- The browser projection cannot silently miss committed server state.
- Server-owned restore, generation, asset, import/export, and command paths have
  explicit durability and resync behavior.
- Hot protocol paths are measured and narrow where the current whole-corpus path
  is unnecessary.
- Repeated REST reads, stream fanout, and UI watcher loops have caps,
  suppression, or server-side aggregation.
- Route ownership, auth, writer gating, and operational limits remain explicit.

## Boundary Sources

- [`../AUDIT.md`](../AUDIT.md) seeded the risk inventory and priority order for
  this plan; [`status.md`](status.md) records which items have since closed.
- [`../SERVER-AND-CLIENT.md`](../SERVER-AND-CLIENT.md) owns the server/client
  responsibility split.
- [`../SERVER-AND-CLIENT-PROTOCOL.md`](../SERVER-AND-CLIENT-PROTOCOL.md) owns
  the current protocol model and earlier performance plan inputs.
- [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md)
  and [`../structure/data-and-events.md`](../structure/data-and-events.md) own
  projection, hydration, revision, event, auth, and active-writer references.
- The codebase remains the source of truth when docs drift.

## Current Baseline

Fastify owns durable state, SQLite revision state, command-event history, chat
messages, memory tables, assets, backups, import/export, prompt assembly, and
server-routable generation. The browser renders a projected database, hydrates
heavy fields on demand, sends revision-checked commands, consumes SSE events,
and falls back to full bootstrap when replay or targeted projection cannot
prove continuity.

The old single-page plan produced the Phase 0 foundations: opt-in protocol
metrics, hydration bounds, SQLite-backed command-event replay, and the
route/protocol manifest. Follow-up commits closed the Phase 1 P1 correctness
risks, moved `settings.updated` and plugin-storage commands to message-free
mutation paths, narrowed known targeted projection resources, indexed asset
metadata lookups, and added bulk all-chat hydration.

Remaining work is concentrated in still-hydrated command families
(`chat`, `message`, `generation`), full-bootstrap fallbacks for sprawling
resources, optional lorebook bulk reads, import/export memory pressure, client
watcher echo, and stream/backpressure edges.

## Invariants

- Preserve `baseRevision` conflict behavior and one revision bump per committed
  projected mutation.
- Preserve `BEGIN IMMEDIATE` serialization or document an equivalent durability
  rule before introducing a narrow write path.
- Persist exactly one replayable command event for every revision-tracked
  projected mutation.
- Keep bootstrap and targeted projection message-light unless the phase
  explicitly changes a read model.
- Keep route auth explicit with `requireAuth()` decisions and route manifest
  coverage.
- Keep server-owned mutating routes active-writer classified.
- Keep direct browser writes to server-backed projection state guarded.
- Treat full bootstrap fallback as a recovery path and a protocol health signal,
  not as the normal way to reconcile.

## Phase Overview

| Phase                                                                                 | Goal                                                                                                            |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [0. Baseline Foundations](phases/phase-0-baseline-foundations.md)                     | Preserve and document implemented measurement, hydration bounds/aggregation, replay history, and manifest work. |
| [1. Correctness Hardening](phases/phase-1-correctness-hardening.md)                   | Close confirmed P1 risks before optimizing lower-severity costs.                                                |
| [2. Command Write Cost](phases/phase-2-command-write-cost.md)                         | Reduce whole-corpus command mutation cost without weakening revision/event contracts.                           |
| [3. Read Projection Efficiency](phases/phase-3-read-projection-efficiency.md)         | Reduce targeted projection, asset metadata, bulk hydration, and full resync read cost.                          |
| [4. Stream And Generation Resilience](phases/phase-4-stream-generation-resilience.md) | Bound SSE fanout, improve reattach behavior, cap resend cycles, and make terminal persistence retryable.        |
| [5. Import, Export, Asset Memory](phases/phase-5-import-export-asset-memory.md)       | Reduce large-payload memory pressure and make asset mutation durability explicit.                               |
| [6. Client Loop Suppression](phases/phase-6-client-loop-suppression.md)               | Prevent server-origin refreshes, polling, and high-frequency controls from echoing into excess commands.        |
| [7. Route Operations Coverage](phases/phase-7-route-operations-coverage.md)           | Add route-level operational safeguards and close route coverage gaps.                                           |
| [8. Verification Budgets](phases/phase-8-verification-budgets.md)                     | Turn request counts, payload sizes, metrics, and latest verification into maintained gates.                     |

## Suggested Execution Order

1. Continue Phase 2 only with measured, narrowly scoped command-family slices.
2. Use Phase 3 for optional lorebook bulk reads or full-resync budgets when
   measurement shows they matter.
3. Harden stream fanout and generation lifecycle edges in Phase 4.
4. Address import/export and asset memory pressure in Phase 5.
5. Suppress client loops and high-frequency command writes in Phase 6.
6. Add route limits, schemas, and coverage refinements in Phase 7.
7. Promote proven measurement into Phase 8 budgets.

## Not In This Plan

- Replacing the command/event protocol with a new sync model.
- Re-enabling browser-local persistence paths in Fastify mode.
- Adding multi-user or hosted isolation semantics.
- Widening unsupported plugin, MCP, tool/function, browser side-effect, or
  legacy generation behavior.
- Claiming full server-restart survival for in-flight provider streams before a
  separate durable stream contract exists.
