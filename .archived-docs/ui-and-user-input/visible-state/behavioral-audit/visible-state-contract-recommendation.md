# Recommendation — Graduating the Visible State Test Contract to an Enforced Gate

Today the Visible State Test Contract (`docs/structure/testing-and-operations.md` §"Visible
State Test Contract") is **policy guidance**, not an enforced gate. This audit proves the
contract is mechanically checkable: a `data-risu-*` DOM oracle plus the
`classifyDifferential` helper gives an objective pass/fail with no human oracle. This
document recommends which surfaces should graduate from policy to an enforced check, and how.

## Why graduate at all

The recurring loop the plan describes — logic audit lands, user opens the app, UI bug
surfaces — happens because the test apparatus asserts the wrong layer. The recent fix
commits added DOM tests, but two structural holes remain that policy alone will not close:

1. **Source-scan proxies masquerade as behavioral tests.** `src/App.routeEffect.test.ts`
   guards the tab-stability fix by `readFileSync` + regex on `App.svelte`. It passes as
   long as the literal `untrack(...)` survives in source, and would go green if the same
   reset were reintroduced through a different effect. The Tier-2 DOM-oracle test catches
   the *behavior* regardless of the mechanism (see `phase0-acceptance-gate.md`).
2. **Single-seam tests with the rest mocked.** `SideChatList.svelte.test.ts` mocks the
   router, so the click → `navigate` → `applyRouteToStores` → `chatPage` → repaint path is
   never exercised end to end. Each seam is green in isolation while the joined journey can
   still ship broken.

## Tiering rule to enforce

Graduate the contract as a **two-tier obligation**, keyed off the change surface
(the contract already lists these triggers: `DBState`, `selectedCharID`, `chatPage`,
projection writes, bootstrap/resync/SSE, optimistic command helpers, bridge watchers,
router selection, array create/delete/reorder, `$derived`/`$effect`, keyed lists, memo
signatures, render dependency keys):

| If the change touches… | Required test |
| --- | --- |
| A single component's `$derived`/`$effect`/keyed-list render off store values | **Tier 1** DOM-oracle (happy-dom mount, real click, `data-risu-*` assert, store classifies). |
| A cross-component journey through the **router / `applyRouteToStores` / projection refreeze / SSE reconcile / bridge debounce** | **Tier 2** DOM-oracle (`phase0VisibleState.spec.ts` pattern). A Tier-1 test that mocks the router **does not** satisfy the obligation for these. |

Hard rule, derived from the audit's anti-goals: **a source-scan or helper/store/command-
payload assertion does not satisfy the contract for a visible-state change.** It may
support the test, but the success oracle must be the rendered DOM after the same transition.

## Surfaces to graduate first (priority order)

These are the highest churn × visibility surfaces, each now backed by a proven DOM-oracle
pattern this audit can point at:

1. **Active-chat generation controls** (`ChatGenerationSettingsControls.svelte`,
   `Toggles.svelte`). Already strongly covered by `chatGenerationSettingsControls.test.ts`
   plus the new `phase0Journey4Grouping.dom.test.ts` / `phase0Journey2TogglePaint.dom.test.ts`.
   Gate: any change to the picker/toggle render or the `resolveActiveChatGenerationSettings`
   projection requires a Tier-1 DOM-oracle test.
2. **Route → store application (`App.svelte` effect)**. Replace the
   `App.routeEffect.test.ts` source-scan with (or add alongside it) the Tier-2 tab-stability
   DOM oracle (`phase0VisibleState.spec.ts` Journey 3). Gate: any change to the
   route-application effect or `closeRouteBlockingViews` requires the Tier-2 behavioral test.
3. **Sidebar chat lifecycle** (`SideChatList.svelte`). The Tier-1 suite is good but
   router-mocked; add a Tier-2 chat-switch journey (`phase0VisibleState.spec.ts` Journey 1)
   so the joined click → route → repaint path is gated, not just the seams.
4. **Transcript paint on send/swipe/regenerate** (`DefaultChatScreen` / chat bubble). The
   existing `rerollSwipePersistence.spec.ts` asserts the *buffer*, not the rendered bubble.
   Graduate a Tier-2 test that asserts the painted transcript row, closing the gap the plan
   names explicitly. (See `findings-register.md` / `phase1-gap-analysis.md`.)

## Mechanism

- Keep the helper `src/lib/_audit/domStateOracle.ts` as the shared oracle for both tiers.
- A lightweight enforcement option that fits this repo's existing style: extend the
  `util/client-thinning-audit.ts` invariant set (or a sibling audit) with a check that any
  PR touching the listed render/route/projection files adds or updates a `*.dom.test.ts` /
  `phase0VisibleState`-style spec — i.e. the same "rule has a failing+bypass fixture"
  discipline already used for the architecture audit. Start in **report-only** mode for the
  priority-1/2 surfaces, then flip to blocking once the team is comfortable.
- Do **not** enforce on pure cosmetics (spacing/color/theme with no state mismatch) or on
  server/data-correctness changes (covered by the route and smoke suites).
