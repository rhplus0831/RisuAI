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

- [ ] Add one startup coordinator with monotonic phase transitions, attempt IDs,
  per-capability failure state, and targeted retry.
- [ ] Expose narrow selectors for `canRenderShell`, `canApplyRoutes`,
  `canMutate`, `pluginsReady`, and `canGenerate`.
- [ ] Integrate the Phase 0 marks at the coordinator boundary rather than in
  individual screens.
- [ ] Make retry idempotent: accepted mutations, listeners, timers, and already
  successful phases must not be duplicated.

### 3B. Writer sequence and command enforcement

- [ ] Express the existing writer-critical sequence as coordinator steps without
  changing its order.
- [ ] Keep first-run initialization and internal replay behind named internal
  capabilities while ordinary commands remain disabled.
- [ ] Extend `canUseServerCommands()` so writer ownership alone is insufficient;
  ordinary calls also require `canMutate`.
- [ ] Apply the same guard to the compatibility resource facade and any direct
  programmatic command entry points.
- [ ] Install the resource write guard before any early projection becomes
  visible.
- [ ] Clear mutation and generation capability immediately when writer access is
  lost, while allowing an authenticated observer projection to remain readable.

### 3C. Shell and `loadedStore` migration

- [ ] Set `canRenderShell` only after writer recovery and Phase 2 shell resources
  are coherent for the conservative release.
- [ ] Inventory every `loadedStore` read. Assign it to rendering, routing,
  mutation, generation, plugin, or background readiness.
- [ ] Migrate consumers in bounded groups. Keep `loadedStore` only as a
  documented compatibility derivation while migration is incomplete.
- [ ] Give the compatibility alias an explicit deletion gate; do not add new
  consumers.
- [ ] Split the root render decision from persistence-capable route application.

### 3D. Route, chat, and event readiness

- [ ] Let URL parsing happen early, but wait for `canApplyRoutes` before a route
  can persist selection or other server state.
- [ ] Set `canGenerate` only after selected character detail, selected chat,
  prompt-template owner, plugins, generation reattachment, and recovered effects
  are ready.
- [ ] Report the specific missing chat dependency instead of falling back to a
  generic global loading state.
- [ ] Subscribe to events from the last coherently applied revision and test
  events arriving between every coordinator transition.
- [ ] Ensure a newer route or selected-character request supersedes older
  in-flight hydration.

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
