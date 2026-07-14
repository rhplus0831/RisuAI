# Phase 0 — Acceptance Gate Proof

The plan's acceptance gate (§6):

> The new DOM-oracle tests must catch a regression the old apparatus allowed. Prove that
> empirically by reverting only a known fix's source hunk on the current tree and showing
> the new test goes red while the old helper-style test stays green. … Phase 0 passes only
> when at least one Tier-1 **and** one Tier-2 DOM-oracle test go red on the reverted source
> while the corresponding helper tests stay green.

**Result: PASS on both tiers.** Both proofs were run on branch `fastify` at `35559c767`,
reverting only the named source hunk (test files excluded), then restoring the tree.

---

## Tier 1 — grouped toggle rendering (`c5fd08f33`)

New DOM-oracle test: `src/lib/_audit/phase0Journey4Grouping.dom.test.ts` (Journey 4).
It mounts the real `Toggles.svelte` with a preset whose template defines a toggle group,
and asserts the painted accordion: `readToggleGroupLabels(target)` (the
`[data-risu-generation-toggle-group]` labels) equals `['Preset Group']`. The store side
(`resolveActiveChatGenerationSettings().displayedSidebarToggles`) is read only to classify.

Inverse-fix proof:

```bash
# Revert ONLY the render hunk; the helper (chatGenerationSettings.ts) is left intact.
git show c5fd08f33^:src/lib/SideBars/Toggles.svelte > src/lib/SideBars/Toggles.svelte

# NEW DOM-oracle test -> RED
pnpm exec vitest run src/lib/_audit/phase0Journey4Grouping.dom.test.ts
#   FAIL  expect(domGroupLabels).toEqual(['Preset Group'])
#         - ["Preset Group"]
#         + []                                   <- no accordion painted

# PRE-EXISTING HELPER test -> GREEN
pnpm exec vitest run src/ts/chatGenerationSettings.test.ts -t "preserves layout-only rows for display"
#   Test Files  1 passed (1)    (resolveDisplayedSidebarToggles still returns the group)

git checkout src/lib/SideBars/Toggles.svelte   # restore
```

Delta: the **render** regressed (no `[data-risu-generation-toggle-group]` painted), but the
**helper** that computes the grouping is unchanged — so the helper-layer test stays green
and is blind to the regression. The DOM-oracle test catches it.

---

## Tier 2 — sidebar tab stability (`09eae20d3`)

New DOM-oracle test: `server/fastify/browser-smoke/phase0VisibleState.spec.ts` →
*"Journey 3 (GATE): the sidebar tab stays on 'character' after a generation-settings save"*.
It boots the real Fastify-served browser, clicks a chat row (a real `navigate`, so the
route-application `$effect` is the one driving store state), clicks the
`[data-risu-sidebar-tab="character"]` tab, then triggers an unrelated full projection
refreeze (a state import → `state.imported` → `forceServerProjectionResync`). The store
side (`getDatabaseSnapshot()` still holds the character's 2 chats) is asserted first; the
DOM oracle is that `[data-risu-sidebar-tab="character"][data-risu-sidebar-tab-active]`
remains `"true"`.

Inverse-fix proof:

```bash
# Revert ONLY the untrack hunk in App.svelte (remove the wrapper + the import).
#   -    untrack(() => { void applyRouteToStores(route) })
#   +    void applyRouteToStores(route)
pnpm exec cross-env VITE_FASTIFY_BROWSER_SMOKE=TRUE VITE_RISU_LEGAL_CONFIGURED=TRUE pnpm build:site

# NEW DOM-oracle test -> RED
pnpm exec playwright test -c playwright.fastify-smoke.config.ts phase0VisibleState
#   ✓ Journey 1  (chat switch — untrack-independent)
#   ✓ Journey 2  (toggle settle — untrack-independent)
#   ✘ Journey 3  expect(sidebarTabActive('character')).toBe(true)  ->  Received: false
#                (the store poll for 2 chats PASSED first: store correct, DOM tab reset)

# PRE-EXISTING HELPER test (route logic) -> GREEN
pnpm exec vitest run src/ts/router.test.ts
#   Test Files  1 passed (1)    (applyRouteToStores logic is correct)

git checkout src/App.svelte   # restore, then rebuild
```

Delta: the route **logic** is correct (`router.test.ts` green) and the data layer is
correct (the snapshot still has both chats), yet the rendered sidebar tab resets from
"character" to "chat" because the route-application effect re-runs on the unrelated
`DBState.db` reassignment and calls `closeRouteBlockingViews()` → `botMakerMode.set(false)`.
A helper/logic test cannot see this; the DOM-oracle test does.

### Bonus contrast — why the behavioral test matters

The fix `09eae20d3` ships only a **source-scan** guard, `src/App.routeEffect.test.ts`,
which `readFileSync`s `App.svelte` and regex-matches for `untrack(...)`. On the reverted
tree:

```bash
pnpm exec vitest run src/App.routeEffect.test.ts
#   Test Files  1 failed (1)   (it greps the source, so it does catch the revert —
#                               but only as a brittle proxy, not as observed behavior)
```

It catches the revert only because it inspects source text. It would stay green if the
same reset were reintroduced through a *different* code path (e.g. another effect reading
`DBState.db`). The Tier-2 DOM-oracle test asserts the observed behavior and is robust to
how the reset is reintroduced. This is exactly the apparatus shift the audit argues for.

---

## Reproduction notes (non-obvious harness facts)

- The smoke build renders the **Terms-of-Service modal** (`AlertComp`, `z-50`) which
  intercepts clicks. The Tier-2 spec pre-accepts it with
  `page.addInitScript(() => localStorage.setItem('tos4', 'true'))` before `goto`.
- `CheckInput.svelte` renders the real `<input class="hidden">`; the `<label>` is the
  click target in a real browser (happy-dom does not care).
- The route-application `$effect` tracks `DBState.db.characters` **only** when it runs via
  a real `navigate` (clicking a chat row), not via the state-driven `selectCharacter` hook
  (which returns early through `consumeStateDrivenRouteUpdate()`). The Tier-2 gate reaches
  the chat route by clicking a row for this reason.
- A fine-grained `mergeServerProjectionCharacterRow` does not reassign `DBState.db`, so it
  does not re-fire the effect. A full `forceServerProjectionResync`
  (`applyServerProjectionDatabase`) does. The re-import payload includes `currentChar: 0`
  so the resync keeps the character selected (otherwise the tab bar unmounts entirely).
