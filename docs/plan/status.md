# Server/Client Protocol Stability And Performance Status

Date: 2026-06-01

This is the status router for the Fastify server/client protocol stability and
performance workstream. Use it first, then open only the phase or slice needed
for the next task.

Current status reflects the current codebase after the Phase 8
verification-budget work and later docs-only plan updates.

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
  message-free mutation path. `message.appended`, message
  edit/delete/truncate/replace commands, and `generation.persisted` use
  targeted SQLite paths. Generation prompt assembly and assembly-time
  side-effect persistence now emit opt-in protocol metrics to measure the
  remaining whole-corpus generation costs before selecting another narrow path.
- Phase 3 read-side optimizations are in place: targeted projection field
  selectors for known resource families, an in-process asset metadata index,
  and authenticated bulk all-chat hydration.
- Phase 4 runtime resilience work is implemented: `/api/v1/events`, inline and
  durable chat-generation SSE, and proxy WebSocket stream jobs have bounded
  slow-consumer behavior; active-chat changes plus full resyncs can trigger
  generation reattach; server-owned resend cycles have a per-root-action cap;
  and finalization retries are SQLite-backed. A low-risk shared SSE taxonomy
  check remains planned for future chat stream vocabulary changes.
- Phase 5 is implemented: revision/event atomicity, expanded import limits,
  bundle export streaming, per-generation asset caching, and asset mutation
  rollback are in place. Import, restore, initialization, asset upload/bulk
  upload, and Realm asset paths now persist replayable events with revision
  bumps or roll back staged file/metadata changes; oversized multipart `.risu`
  and Realm charx imports are rejected before durable commits.
- Phase 6 is implemented: settings debounce/coalescing and equality-noop
  suppression are in place, memory job refresh is SSE-driven with
  non-overlapping list requests, and server-origin projection applies advance a
  shared watcher epoch so settings, chat, and script-definition watchers refresh
  baselines instead of echoing commands. Existing lorebook no-data-loss coverage
  remains in place.
- Phase 7 is implemented: selected abuse-prone endpoints have explicit
  route-local rate limits, route-manifest wildcard/prefix coverage is in place,
  read-only writer-header hygiene is tested, HEAD/body-parser safeguards are in
  place, and stable read-only POST envelopes now have initial schema coverage.
- Phase 8 is implemented: bootstrap and targeted projection payload metrics have
  regression coverage, message-light bootstrap/projection responses are
  compared against explicit chat-message hydration for message-heavy histories,
  and all-chat hydration has a request-count guard proving many stubbed chats
  hydrate through one bulk request with cached follow-up calls starting no new
  requests. Command mutation metrics now have review gates for the
  `message-free`, `targeted-message`, and `targeted-generation` hot paths,
  while targeted paths keep hard `dbJsonWriteMs: 0` checks. The latest focused
  verification result is recorded in [`latest-verification.md`](latest-verification.md).

No P1 plan risks remain open after the Phase 1 commits.

Active performance risks:

- Generation and prompt assembly can still perform whole-corpus passes for
  assembly-time side effects and prompt construction; these paths now have
  focused opt-in metrics for the next narrow optimization decision.
- Full-bootstrap fallbacks for sprawling resources such as `settings`, `state`,
  and `pluginStorage` remain expensive.
- General asset byte reads remain one request per asset, although metadata
  lookup is no longer reparsed for every lookup and repeated prompt-assembly
  asset references are cached within a generation request.
- Optional lorebook hydration is still N requests when experimental
  `enableLorebookStubs` is enabled.
- Export paths still materialize `.risu` payloads, although bundle export no
  longer rehydrates the repository twice or preloads every asset byte buffer.

## Latest Verification

See [`latest-verification.md`](latest-verification.md) for the latest
maintained full or focused verification result.

## Start Here

- Use [`next-steps.md`](next-steps.md) to choose the next task.
- Use [`plan.md`](plan.md) for invariants and phase order.
- Use [`phases/README.md`](phases/README.md) for all phase docs.
- Prefer measured P2/P3 work when a narrow slice exists; otherwise use
  [`next-steps.md`](next-steps.md) to select optional lorebook/full-resync
  work, SSE taxonomy verification, or verification-log maintenance.

## Phase Router

| Phase                                                     | Status                               | Open when working on...                                                                |
| --------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| [Phase 0](phases/phase-0-baseline-foundations.md)         | Implemented foundation, keep current | Existing metrics, hydration bounds/aggregation, durable event history, route manifest. |
| [Phase 1](phases/phase-1-correctness-hardening.md)        | Implemented                          | Closed P1 correctness hardening.                                                       |
| [Phase 2](phases/phase-2-command-write-cost.md)           | Hot command paths targeted           | Whole-corpus command mutation cost and narrow write paths.                             |
| [Phase 3](phases/phase-3-read-projection-efficiency.md)   | Read optimizations implemented       | Targeted projection, asset metadata reads, bulk read endpoints, full resync budgets.   |
| [Phase 4](phases/phase-4-stream-generation-resilience.md) | Runtime implemented                  | Stream, generation reattach, resend, finalization retry, and SSE taxonomy checks.      |
| [Phase 5](phases/phase-5-import-export-asset-memory.md)   | Implemented                          | Closed import/export memory and asset mutation durability work.                        |
| [Phase 6](phases/phase-6-client-loop-suppression.md)      | Implemented                          | Closed client loop suppression and watcher echo work.                                  |
| [Phase 7](phases/phase-7-route-operations-coverage.md)    | Implemented                          | Route operational safeguards, route-limit maintenance, manifest coverage.              |
| [Phase 8](phases/phase-8-verification-budgets.md)         | Implemented                          | Verification budgets and latest verification log.                                      |

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
