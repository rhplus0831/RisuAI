# Phase 6: Bridges, Lifecycle & Network (Root 6)

Status: complete; proof refreshed on 2026-06-06. Independent; order by pain.

Goal: stop bridge watchers from echoing server-originated edits back as
commands, fix the DOM-observer listener accumulation, and bound the client's
lifecycle state and reconnect behavior.

Findings: M11, M12, M14, L35, L36, L45, L46, L47.

## Slices

- M11/M12:
  [`slices/phase-6-bridges-lifecycle-network/bridge-apply-epoch-echo-guards.md`](slices/phase-6-bridges-lifecycle-network/bridge-apply-epoch-echo-guards.md)
  - suppress foreign projection echoes from lorebook and character-profile
    watchers.
- M14:
  [`slices/phase-6-bridges-lifecycle-network/dom-observer-idempotent-bindings.md`](slices/phase-6-bridges-lifecycle-network/dom-observer-idempotent-bindings.md)
  - bind code-block/BGM DOM observers once and remove the unbounded polling
    listener accumulation.
- L35:
  [`slices/phase-6-bridges-lifecycle-network/character-row-hypav3-carryover.md`](slices/phase-6-bridges-lifecycle-network/character-row-hypav3-carryover.md)
  - carry hydrated `hypaV3Data` through character-row refreshes independently
    of message length.
- L36:
  [`slices/phase-6-bridges-lifecycle-network/prereroll-map-bounds.md`](slices/phase-6-bridges-lifecycle-network/prereroll-map-bounds.md)
  - bound the pre-reroll response buffers and clear stale entries on lifecycle
    boundaries.
- L45:
  [`slices/phase-6-bridges-lifecycle-network/server-projection-reconnect-backoff.md`](slices/phase-6-bridges-lifecycle-network/server-projection-reconnect-backoff.md)
  - add capped exponential backoff with jitter for command-event reconnects.
- L46/L47:
  [`slices/phase-6-bridges-lifecycle-network/mcp-sse-dedup-and-fetchnative-log.md`](slices/phase-6-bridges-lifecycle-network/mcp-sse-dedup-and-fetchnative-log.md)
  - bound MCP legacy SSE dedup ids and remove the `fetchNative` body log.
- Proof:
  [`slices/phase-6-bridges-lifecycle-network/phase-6-verification-refresh.md`](slices/phase-6-bridges-lifecycle-network/phase-6-verification-refresh.md)
  - refresh gates, focused proofs, full validation, and latest verification.

## Source Anchors

- [`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md) -
  M11, M12, M14, L35, L36, L45-L47.
- M11: `src/ts/server/lorebookBridge.svelte.ts`
  (`watchServerBackedLorebooks`, no apply-epoch gate); note
  `hydrateServerCharacterLorebook` runs under
  `withTrustedServerProjectionWrite`, which does NOT bump the epoch.
- M12: `src/ts/server/characterBridge.svelte.ts`
  (`watchServerBackedCharacterProfile`); gate precedent: the chat/script/
  settings watchers.
- M14: `src/ts/observer.svelte.ts` (`startObserveDom` 10 Hz poll,
  non-idempotent `nodeObserve`, dead MutationObserver).
- L35: `src/ts/storage/database.svelte.ts`
  (`mergeServerProjectionCharacterRow` hypaV3Data carry-over gated on
  `priorMessage.length > 0`).
- L36: `src/ts/process/prereroll.ts` (unbounded `rerolls`/`rerollIndex`
  maps).
- L45: `src/ts/bootstrap.ts` (`scheduleServerProjectionReconnect`, fixed
  1 s retry).
- L46/L47: `src/ts/process/mcp/mcplib.ts` (`sseIdDone`),
  `src/ts/globalApi.svelte.ts` (`fetchNative` body log).

## Planned Shape

- M11/M12 reuse the sibling watchers' pattern: capture
  `previousProjectionApplyEpoch`, and when the epoch advanced this fire,
  reset the baseline snapshot and return without dispatching. M11
  additionally switches foreign character-lorebook application to an
  epoch-bumping apply so the gate covers it.
- M14: WeakSet/data-attribute idempotence in `nodeObserve` at minimum;
  preferably wire the already-constructed MutationObserver and delete the
  poll. Listener detach on node removal.
- L45: capped exponential backoff with jitter (1 s -> ~30 s), reset on
  successful subscribe; keep the `replay-unavailable` resync semantics.
- Two-session echo tests for M11/M12: simulate a foreign event apply and
  assert zero outbound dispatches while a local edit still dispatches.

## Exit Criteria

- [x] M11/M12: a foreign projection apply produces zero echoed commands
      while local edits still dispatch (both watchers, epoch-gate tests).
- [x] M14: repeated observe ticks bind each code block exactly once
      (listener-count assertion); context menu behavior unchanged.
- [x] L35: hypaV3Data survives a foreign characterRow refresh when the
      hydrated chat has zero live messages.
- [x] L36: prereroll maps are bounded (LRU/active-chat) with reroll
      navigation behavior unchanged.
- [x] L45: reconnect attempts back off under a simulated outage and reset on
      success.
- [x] L46/L47: `sseIdDone` bounded; `fetchNative` body log removed.
- [x] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/lorebookBridge.test.ts src/ts/server/characterBridge.svelte.test.ts
pnpm exec vitest run src/ts/observer.svelte.test.ts
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/bootstrap.test.ts src/ts/server/events.test.ts
pnpm exec vitest run src/ts/process/prereroll.test.ts src/ts/process/rerollNavigation.test.ts src/ts/process/rerollNavigation.guard.test.ts src/ts/process/rerollNavigation.rollback.test.ts
pnpm exec vitest run src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/mcplib.test.ts src/ts/globalApi.fetchNative.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm check
git diff --check
```

2026-06-06 proof refresh: all focused suites, both gates, `pnpm test`,
`pnpm api:test`, `pnpm client-thinning:audit`, and both TypeScript checks
passed. `pnpm check` still fails on the unrelated pre-existing 14-error
baseline in `PlaygroundMenu.svelte`, Fastify repository/routes files, and
`sendChat.fixtures.serverBacked.test.ts`.
