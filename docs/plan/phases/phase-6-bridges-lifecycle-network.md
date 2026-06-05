# Phase 6: Bridges, Lifecycle & Network (Root 6)

Status: pending. Independent; order by pain.

Goal: stop bridge watchers from echoing server-originated edits back as
commands, fix the DOM-observer listener accumulation, and bound the client's
lifecycle state and reconnect behavior.

Findings: M11, M12, M14, L35, L36, L45, L46, L47.

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

- [ ] M11/M12: a foreign projection apply produces zero echoed commands
      while local edits still dispatch (both watchers, epoch-gate tests).
- [ ] M14: repeated observe ticks bind each code block exactly once
      (listener-count assertion); context menu behavior unchanged.
- [ ] L35: hypaV3Data survives a foreign characterRow refresh when the
      hydrated chat has zero live messages.
- [ ] L36: prereroll maps are bounded (LRU/active-chat) with reroll
      navigation behavior unchanged.
- [ ] L45: reconnect attempts back off under a simulated outage and reset on
      success.
- [ ] L46/L47: `sseIdDone` bounded; `fetchNative` body log removed.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/lorebookBridge.test.ts
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/events.test.ts
pnpm exec vitest run src/ts/process/rerollNavigation.test.ts
pnpm test && pnpm client-thinning:audit
```
