# Phase 3: Startup Capabilities

## Outcome

Replace the overloaded `loadedStore` boundary with monotonic, observable
capabilities. The conservative first release may render the shell after writer
recovery and thin shell resources are coherent, while chat-only and optional
work continues.

This phase starts only after
[Phase 1](01-entry-and-bundle-boundaries.md) and
[Phase 2](02-thin-character-summaries.md) pass their exit gates.

## Current owners

- Coordinator, readiness diagnostics, and startup-step retry:
  `src/ts/startupReadiness.ts`
- Bootstrap sequencing and event subscription: `src/ts/bootstrap.ts`
- Runtime bootstrap transport: `src/ts/server/bootstrap.ts`
- Writer state: `src/ts/server/activeWriterSession.ts`
- Outbox preparation/replay: `src/ts/server/pendingMutationOutbox.ts` and
  `src/ts/server/pendingMutationReplay.ts`
- Command and revision gates: `src/ts/server/commands.ts`
- Resource refresh/invalidation: `src/ts/server/resourceRefresh.ts` and
  `src/ts/server/resourceInvalidation.ts`
- Route effects: `src/App.svelte` and `src/ts/router.ts`
- Generation dependencies: `src/ts/server/generationOperations.ts`,
  `src/ts/process/reattach.ts`, and prompt/chat hydration modules

## Immutable writer-critical order

The coordinator must preserve this sequence:

1. Adopt the pending mutation owner when unambiguous.
2. Request writer-intent bootstrap and complete any confirmed takeover.
3. Initialize a genuinely fresh server database when necessary.
4. Prepare the pending outbox for writer epoch and database lineage.
5. Flush durable receipt acknowledgements.
6. Replay pending mutations and prove no blocking current-owner intent remains.
7. Read and apply an authoritative post-replay resource revision.
8. Install revision cursors, reconciliation, event subscription, and the
   resource write guard.

No user-originated command may use the narrow internal initialization or replay
bypass.

## Review slices

### 3A. Coordinator and diagnostics

- [x] Add one startup coordinator with monotonic phase transitions, attempt IDs,
  per-capability failure state, and targeted retry.
- [x] Expose narrow selectors for `canRenderShell`, `canApplyRoutes`,
  `canMutate`, `pluginsReady`, and `canGenerate`.
- [x] Integrate the Phase 0 marks at the coordinator boundary rather than in
  individual screens.
- [x] Make retry idempotent: accepted mutations, listeners, timers, and already
  successful phases must not be duplicated.

#### 3A implementation record (2026-08-24)

`startupReadiness.ts` now owns the monotonic milestone timeline, attempt and
per-capability failure diagnostics, the five narrow selectors, targeted retry
deduplication, and successful-step retention. `loadData()` uses coordinator
steps for the writer/shell path, push runtime, plugin runtime, generation
recovery, and background runtime. A retry resumes at the failed step instead of
repeating completed recovery work or registering its listeners and timers
again. Concurrent `loadData()` callers also share one attempt loop.

At the 3A checkpoint this slice was deliberately behavior-preserving:
`loadedStore` remained the UI compatibility boundary, and commands and routes
did not consume the new capabilities until 3B and 3C. The browser-smoke hook
exposes the serializable coordinator snapshot alongside the Phase 0 timeline.

Focused coordinator/bootstrap/report tests pass 170 tests. `pnpm check`,
`pnpm build:smoke`, the small/large cold/warm startup matrix, and
`pnpm test:affected` pass; the affected frontend selection covers 5,068 tests
across 332 files. The production preload report remains at 12 files, 318,621
gzip bytes total, and a 283,372-byte largest chunk, so both ratified milestone
gates pass.

### 3B. Writer sequence and command enforcement

- [x] Express the existing writer-critical sequence as coordinator steps without
  changing its order.
- [x] Keep first-run initialization and internal replay behind named internal
  capabilities while ordinary commands remain disabled.
- [x] Extend `canUseServerCommands()` so writer ownership alone is insufficient;
  ordinary calls also require `canMutate`.
- [x] Apply the same guard to the compatibility resource facade and any direct
  programmatic command entry points.
- [x] Install the resource write guard before any early projection becomes
  visible.
- [x] Clear mutation and generation capability immediately when writer access is
  lost, while allowing an authenticated observer projection to remain readable.

`loadWebInitialDatabase({ coordinated: true })` now exposes the immutable
writer sequence as ten retained steps, from owner adoption through event
subscription. Ordinary command admission and queued execution require
`canMutate`; only the named bootstrap initializer and exact durable pending
replay receive private, module-scoped bypasses. The resource write guard is
enabled before initial hydration. A writer-takeover response synchronously
revokes route, mutation, and generation capabilities without hiding the
coherent shell.

### 3C. Shell and `loadedStore` migration

- [x] Set `canRenderShell` only after writer recovery and Phase 2 shell resources
  are coherent for the conservative release.
- [x] Inventory every `loadedStore` read. Assign it to rendering, routing,
  mutation, generation, plugin, or background readiness.
- [x] Migrate consumers in bounded groups. Keep `loadedStore` only as a
  documented compatibility derivation while migration is incomplete.
- [x] Give the compatibility alias an explicit deletion gate; do not add new
  consumers.
- [x] Split the root render decision from persistence-capable route application.

`App.svelte` reads the coordinator store directly: `canRenderShell` controls the
loading branch, while both route effects require `canApplyRoutes`. The visual
settings needed by the root shell are installed before `writer-ready` is
published. At the 3C checkpoint, `loadedStore` remained only as a
background-readiness compatibility alias for bootstrap completion/notification
reconciliation and the browser-smoke compatibility helpers; it had no
production UI or route consumer.

The fixed deletion gate is Phase 7: replace the bootstrap loop and notification
hook with explicit background readiness, migrate `isLoaded()`/`waitForLoaded()`
smoke callers to `background-ready`, then remove the core-store declaration and
compatibility re-export. That gate was completed on 2026-08-25. Bootstrap and
the retained smoke helper names now use the coordinator-owned
`backgroundReady()` selector or wait for the semantic `background-ready`
milestone; no store declaration or re-export remains. New consumers must use a
narrow capability instead.

### 3D. Route, chat, and event readiness

- [x] Let URL parsing happen early, but wait for `canApplyRoutes` before a route
  can persist selection or other server state.
- [x] Set `canGenerate` only after selected character detail, selected chat,
  prompt-template owner, plugins, generation reattachment, and recovered effects
  are ready.
- [x] Report the specific missing chat dependency instead of falling back to a
  generic global loading state.
- [x] Subscribe to events from the last coherently applied revision and test
  events arriving between every coordinator transition.
- [x] Ensure a newer route or selected-character request supersedes older
  in-flight hydration.

The event subscription starts from the coherently applied post-replay revision
before publishing `writer-ready`; replay/gap, stale-result, and command-event
tests protect revision continuity across the later coordinator transitions.
Generation staging, dispatch, retry, cancellation, and direct transport now
require `canGenerate` at admission and execution time. Exact durable pending
replay retains a private recovery path, but writer loss closes it too.

Initial and subsequent selected-character changes run fenced detail/chat
hydration. The reactive active-chat target also revokes generation readiness
for same-character `chatPage` changes. A newer selection invalidates an older
result. Missing character or chat state records
`selected-character-hydration-failed` or
`selected-chat-hydration-failed`, leaves the readable shell and background work
available, and keeps `canGenerate` false until a later coherent selection
clears the localized failure.

#### Integrated Phase 3 evidence (2026-08-24)

Focused coordinator, bootstrap, route DOM, command, writer-loss, generation,
and resource tests pass. Local `pnpm test:affected` covers 515 frontend files
and 6,425 tests, 4 gate files and 9 tests, and 152 server files with 3,298 tests
passing and 1 skipped. `pnpm check`, `pnpm check:server`, `pnpm format:check`,
the production and smoke builds, and all 5 targeted browser-smoke tests pass;
the browser set includes the four-case small/large cold/warm startup matrix.

The final production preload closure is 11 files and 318,707 gzip bytes total;
the largest chunk is 283,372 gzip bytes. The 900 KiB total and 500 KiB largest
milestone gates and the historical regression ceilings all pass. Every command
in this evidence record ran locally without GitHub Actions or another external
service.

## Failure and retry behavior

- A failed step records the failed capability and a localized targeted retry.
- Retrying one step does not repeat accepted work or register duplicate runtime
  resources.
- Writer loss clears mutation and generation capability synchronously.
- A late result from an earlier attempt, route, or selection cannot promote a
  newer attempt.

## Verification

- Extend `src/ts/bootstrap.test.ts` for ordering, retries, failure isolation,
  cleanup, and one-time transitions.
- Extend `src/App.routeEffect.dom.test.ts` to prove shell rendering can precede
  persistence-capable route application.
- Add command-layer tests that call programmatic APIs directly while
  `canMutate` is false.
- Extend pending replay and active-writer tests to prove replay precedes ordinary
  commands and writer loss revokes capability immediately.
- Inject events at each phase boundary in resource invalidation/refresh tests and
  prove no revision is skipped.
- Run `pnpm build:smoke`, targeted browser smoke, and `pnpm test:affected`.

## Exit gate

- The shell renders without chat-only or background work.
- Every startup-sensitive action consumes an explicit narrow capability.
- Direct calls cannot bypass mutation or generation readiness.
- `loadedStore` is removed or is a documented compatibility alias with a fixed
  removal condition.
