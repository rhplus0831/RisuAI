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
route/protocol manifest. Later commits closed Phase 1 correctness risks,
narrowed hot Phase 2 command families (`settings`, plugin storage, chat
metadata, message history, and generation persistence), added focused Phase 2
generation/prompt side-effect metrics and reviewed them to select assembly
side-effect persistence, narrowed that path, reduced Phase 3 read costs,
implemented Phase 4 stream/generation runtime resilience, landed Phase 5
revision/event/import/export/asset durability work, suppressed Phase 6 watcher
echoes and no-op settings writes, and added Phase 7 route-local limits,
wildcard manifest coverage, read-only writer-header hygiene, HEAD/body-parser
safeguards, and initial stable-envelope schemas.

Remaining work is concentrated in measured generation/prompt side-effect
passes, full-bootstrap fallback budgets, optional lorebook bulk reads, ordinary
`.risu` export materialization, and the optional SSE taxonomy check.

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

1. Continue Phase 2 only when fresh metrics identify another narrow source area
   with explicit protocol behavior.
2. Use Phase 3 for optional lorebook bulk reads or full-resync budgets when
   measurement shows they matter.
3. Refresh Phase 8 gates and [`latest-verification.md`](latest-verification.md)
   when measurement output or verification scope changes.
4. Add the Phase 4 SSE taxonomy fixture when chat stream vocabulary changes.
5. Add additional route schemas only when touching stable route envelopes.

## Not In This Plan

- Replacing the command/event protocol with a new sync model.
- Re-enabling browser-local persistence paths in Fastify mode.
- Adding multi-user or hosted isolation semantics.
- Widening unsupported plugin, MCP, tool/function, browser side-effect, or
  legacy generation behavior.
- Claiming full server-restart survival for in-flight provider streams before a
  separate durable stream contract exists.
