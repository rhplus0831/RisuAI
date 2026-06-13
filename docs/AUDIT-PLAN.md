# UI/UX Behavioral Audit Plan

Audience: audit agents, either one agent or a fan-out fleet.
Status: ready to execute.

Start with Phase 0. Do not scale past Phase 0 until its acceptance gate is green.

---

## Agent contract

Drive through the real DOM. Assert on the real DOM. Read the store only to
classify.

This audit is about rendered-state divergence. Prior audits verified logic state:
helpers, snapshots, command payloads, and projection-store values. That layer is
already covered. The remaining failures happen one layer out, where a correct
store value does not reach the rendered DOM.

If the evidence for a finding is a store/helper assertion, it is not a finding for
this audit.

Use this loop for every journey:

1. Seed only the starting fixture/state needed for the journey.
2. Drive the measured transition through a real DOM interaction.
3. Assert the rendered DOM.
4. Read the store only after the DOM assertion fails, and only to classify the
   failure.
5. Report only DOM divergence with a correct backing store.

---

## 1. Why this audit exists

The recurring loop has been:

1. An audit finds and fixes logic defects.
2. The user opens the app.
3. UI/UX bugs surface within minutes.
4. Another fix lands, and the loop repeats.

The cause is structural, not effort.

- The test apparatus asserts on the wrong layer. Even the most journey-like
  real-browser test, `server/fastify/browser-smoke/rerollSwipePersistence.spec.ts`,
  drives the flow by calling `selectCharacter()` / `swipeRerollBack()`
  programmatically and asserts on `getRerollCandidates()`, the reroll buffer. It
  would stay green even if the chat bubble never re-rendered. The same is true of
  the happy-dom suite and the three gen-settings tests
  (`activeChatGenerationSettings.test.ts`, `chatGenerationSettings.test.ts`,
  `pickerGenerationSettings.test.ts`): all assert the helper/logic layer.
- Coverage follows files, not journeys. Static fan-outs cover subsystems; UI bugs
  live in the transition between user steps, such as switch chat, toggle, save,
  refreeze. No single-file reader sees that whole path.
- There is no real runtime in the current checks. happy-dom does not reproduce
  projection refreeze, SSE reconcile, or bridge debounce timing, which is exactly
  where these bugs appear.

The user's description of the failures: "the internal logic was fine, but the UI
either did not respond or behaved differently from what the logic implied."

That is a reactivity/binding failure class, not a value-correctness failure class.

---

## 2. Scope

In scope: rendered-state divergence across a transition.

A user-driven transition leaves the rendered DOM disagreeing with a correct store
value. Examples:

- Controls do not reflect stored config after a switch, fork, or import.
- Optimistic changes do not paint, or paint and then wrongly revert.
- Save/refreeze resets an unrelated visible surface, such as tab, selection, or
  scroll.
- A half-hydrated projection shell renders as if it were complete.
- Grouped/keyed lists do not re-render when their backing data changes.

Out of scope: route these elsewhere.

- Logic/value bugs: the store/helper produces the wrong value. Send these to the
  static-test track. The classifier in section 4 explains how to tell.
- Pure cosmetics: spacing, color, font, or theme issues with no state mismatch.
- Server/data correctness: covered by the Fastify route and smoke suites.

---

## 3. Existing infrastructure

Reuse the existing plumbing. Most of it already exists; it has just been aimed at
the store instead of the DOM.

| Asset | Path / command | Use |
| --- | --- | --- |
| Auth-bypass dev server | `pnpm dev:agent` (frontend `:6418`, Fastify `:6419`, `/api` proxied) | Tier-2 real-browser driving; bypasses password and ToS |
| Request traces | `data/trace/agent.jsonl`, `X-Request-UID` header, then `rg "<uid>" data/trace/*.jsonl` | Tie a visible bug to its exact API call |
| Playwright | `playwright.fastify-smoke.config.ts`; `pnpm smoke:fastify-browser` | Tier-2 harness pattern for the real Fastify-served app |
| In-app smoke hook | `src/ts/server/browserSmoke.ts` -> `window.__RISU_FASTIFY_BROWSER_SMOKE__` | Exposes `getDatabaseSnapshot()` as the store side of the differential |
| happy-dom mount | `mount/tick/unmount` from `svelte`; examples in `src/lib/SideBars/SideChatList.svelte.test.ts`, `pickerGenerationSettings.test.ts` | Tier-1 harness |
| Focused UI coverage | `pnpm coverage:ui-map` | Coverage map over ChatScreens/Others/SideBars/server |
| Stable DOM selectors | `data-risu-*` attributes already on target components; see section 6 | DOM-oracle anchors from prior selector-hardening work |
| Visible State Test Contract | `docs/structure/testing-and-operations.md` | Policy this audit turns into enforceable tests |

---

## 4. Method

### 4.1 Rules

1. Drive the transition through the real DOM.

   Click the actual control or type into the actual input. Do not call
   `selectedCharID.set(...)`, helper functions, or commands to produce the
   measured transition. The bug is usually in the wiring between the click handler,
   store update, and re-render; driving via the store bypasses that wiring.

   Seeding initial state before the measured transition via store/fixture is fine.
   The measured transition itself must be DOM-driven.

2. Assert on the rendered DOM.

   Read the painted result: `textContent`, `aria-checked`, a `data-risu-*`
   attribute, or the presence/absence of a row. Do not use the store as the
   success oracle.

3. Read the store only to classify.

   The store is the differential oracle after a DOM failure, not the primary test
   target.

### 4.2 Classifier

At the failing assertion, compare the DOM to the store value that should back it.

| DOM vs store | Verdict |
| --- | --- |
| DOM matches store | No bug. |
| DOM differs from store, store is correct | In-scope reactivity/binding bug. Report it. |
| DOM differs from store, store is wrong | Logic bug. Out of scope; route to static track. |

This makes the audit automatable without a human oracle. For the target class, the
verdict is objective.

### 4.3 Test tiers

Tier 1: happy-dom, real component mount.

Use `mount()` on the real component with its real
`$derived`/`$effect`/projection wiring. Drive a real interaction, `await tick()`,
assert against `data-risu-*` DOM, then classify via the store if the DOM assertion
fails.

Tier 1 catches most non-timing failures: untracked `$derived`, projection writes
the proxy does not observe, keyed `{#each}` mistakes, and grouping derivations.
Follow the existing pattern in `pickerGenerationSettings.test.ts`, including its
use of `setServerProjectionWriteGuardEnabled` and
`clearCachedServerCommandRevision`.

Tier 2: Playwright real browser.

Use this for what Tier 1 structurally cannot see: projection-refreeze races, SSE
reconcile timing, bridge debounce, and full cross-component journeys. Extend
`playwright.fastify-smoke.config.ts`; assert on `page.locator(...)` DOM and
cross-check with `getDatabaseSnapshot()`.

Pick the lowest tier that can reproduce the bug. Do not force timing/refreeze bugs
into Tier 1; they can pass there and still ship.

---

## 5. Failure taxonomy

Svelte 5 runes failure families to look for:

| Family | Symptom | Tier |
| --- | --- | --- |
| Untracked `$derived` dependency | Control shows stale value after a dependency it did not track changes | 1 |
| Projection write not observed | Guarded `DBState.db` write replaces a ref the proxy does not react to | 1 |
| Keyed `{#each}` mis-key | List item content changes but row does not re-render, or wrongly remounts | 1 |
| Grouping/structural derivation | Grouped toggles collapse or duplicate when backing data changes | 1 |
| `$effect`/`untrack` swallow | `App.svelte:90` `untrack(applyRouteToStores)` resets sidebar tab/selection on an unrelated refreeze | 2 |
| Optimistic paint/rollback | Optimistic change never paints, or paints then wrongly reverts on reconcile | 1 for paint, 2 for reconcile races |
| Hydration shell as complete | Half-hydrated projection renders as final, blank, or partial before hydration lands | 2 |

Projection-narrowing lead:

The perf campaign narrowed optimistic writes/projections from whole-object clones
to single scoped fields. Evidence that this generated UI drift appears in these
commits: `perf: narrow prompt-items commands + fix promptItem projection field`,
`fix persona projection scalars`, `fix loadout projection scalar`, and
`perf: drop the prompt projection field-bug; fall back to full`.

For every narrowed projection/rollback, check whether any rendered surface depends
on a field outside the narrowed scope. If yes, record both fix options:

- Include that field in the narrow projection.
- Make the rendered surface depend only on projected fields.

---

## 6. Phase 0: proof slice

Scope: chat-scoped generation controls plus toggle rendering/tab stability.

These targets share the same failure shape: a control must mirror stored config,
and mutating it must survive a refreeze.

Target map:

| Target | What to use it for |
| --- | --- |
| `src/lib/SideBars/ChatGenerationSettingsControls.svelte` | Generation settings DOM. Start at `[data-risu-generation-settings-picker-controls]`. Use `[data-risu-generation-picker-control][data-risu-picker-kind="preset"|"persona"]` and `data-risu-picker-selected-id={...}` as the DOM side of the differential. Check `[data-risu-generation-reset-defaults]` for active-chat disabled state. |
| `src/lib/SideBars/Toggles.svelte` | Toggle rendering. Check `groupSidebarToggles(...)` output with `kind: 'group'` and `children`; values come from `activeGenerationSettings.settings.sidebarToggles[key]`. |
| `src/ts/activeChatGenerationSettings.ts` | Store classification only. Use `resolveActiveChatGenerationSettings` as the store side of the differential. |
| `src/App.svelte:90` | Tab-reset seam. Watch `untrack(() => applyRouteToStores(route))` during unrelated refreeze. |

### Phase 0 journeys

| # | Drive through real DOM | DOM oracle | Store classify | Maps to | Tier |
| --- | --- | --- | --- | --- | --- |
| 1 | Create two chats with different stored generation settings; click chat B in `SideChatList` | `data-risu-picker-selected-id` and visible preset/persona name show B's values | `resolveActiveChatGenerationSettings().settings.presetId` equals B's value | `eebe1fe28` | 1 |
| 2 | Click a sidebar/jailbreak toggle in `Toggles.svelte` | Toggle visual flips and stays after command/refreeze settles | `settings.sidebarToggles[key]` equals new value | `f9ba2bf31`, `86da1a117` | 1 for paint, 2 for settle |
| 3 | Open a sidebar tab, then toggle something that saves | Same tab remains active; selection/list does not reset | route/tab store unchanged | `09eae20d3` | 2 |
| 4 | Change state driving toggle grouping | Group containers and children render grouped in DOM | `displayedSidebarToggles` grouping equals rendered structure | `c5fd08f33` | 1 |

### Acceptance gate

The new DOM-oracle tests must catch a regression the old apparatus allowed.

Prove that empirically by reverting only a known fix's source hunk on the current
tree and showing the new test goes red while the old helper-style test stays
green.

```bash
# Cheap Tier-1 proof: grouped-toggle render (c5fd08f33) or reset-defaults (f9ba2bf31)
git revert --no-commit <fix-sha>        # if it does not apply cleanly, manually invert
                                        # only the .svelte/.ts source hunk; exclude test files
pnpm exec vitest run <new-dom-oracle-test>          # must be RED
pnpm exec vitest run <a-pre-existing-helper-test>   # should stay GREEN; this is the proof delta
git revert --abort                      # restore the tree
```

Run the equivalent proof for one Tier-2 journey, using `09eae20d3` for tab
stability, so both tiers are validated.

Phase 0 passes only when at least one Tier-1 and one Tier-2 DOM-oracle test go red
on the reverted source while the corresponding helper tests stay green. If that
does not reproduce, stop and report; the method needs rethinking before fan-out.

---

## 7. Finding format

Use one file per finding or one row in a register. Every finding needs every field.

```text
ID:            UIA-### (sequential)
Severity:      H | M | L | I (rubric below)
Journey:       the user actions, as a real person would do them
Transition:    the state change being measured
Driver:        the exact DOM interaction used; must be a real click/input
DOM observed:  what rendered
DOM expected:  what should have rendered
Store value:   value at the failing assertion -> classify: store CORRECT (in scope) / WRONG (out)
Root family:   from section 5 taxonomy
Repro test:    path to the failing DOM-oracle test; required
Tier:          1 | 2
Fix sketch:    optional; for narrowing-tax findings, give both projection options
```

Severity rubric:

- H: core/common flow renders state that contradicts a correct store and blocks or
  seriously misleads use. Example: picker shows the wrong preset, so the user sends
  with the wrong config; tab resets mid-edit and loses context. No reasonable
  workaround.
- M: visible divergence on a common flow with a workaround, such as re-click or
  reload; also use for correct-after-delay transient stale state.
- L: edge-path or minor visible divergence; small structural mis-render.
- I: latent risk with no current user-visible manifestation; no-action note.

H/M/L/I matches the V2/V3/V4 stability-audit convention for continuity.

---

## 8. Confirmation bar

A finding is confirmed only when its repro test:

1. Drives the transition through the real DOM, not a store set/helper call.
2. Is red on the current tree.
3. Verifies that the store is correct at the failing assertion.

If the store is wrong, it is a logic bug and out of scope.

A finding without a red DOM-driven test is a hypothesis, not a finding. Reject
"this code looks like it will not react" claims that lack a reproducing test. That
unverified style is exactly how prior audits produced findings that did not stick.

---

## 9. Anti-goals

These are the habits that caused the loop. Do not repeat them.

- Do not assert on store/helper/snapshot/command-payload as the success oracle.
- Do not drive the measured transition by setting a store, calling a helper, or
  issuing a command. Click the control.
- Do not write a happy-dom-only test for a timing/refreeze/SSE-race bug. Use
  Tier 2.
- Do not report code-smell findings without a red DOM repro.
- Do not fix logic here. If the store is wrong, route it to the other track.
- Do not blindly widen a narrowed projection to fix rendering. Record both the
  include-the-field option and the render-only-projected-fields option.
- Do not scale past Phase 0 until its acceptance gate is green.

---

## 10. Phase 1+ journey inventory

Fan out only after Phase 0 passes. Each item becomes one or more DOM-oracle
journeys with the same drive -> assert -> classify shape.

Prioritize by churn times user visibility. Re-validate each new journey with the
section 6 inverse-fix proof where a corresponding fix commit exists.

- Chat lifecycle: create, delete, select, and fork reflected in `SideChatList`
  immediately and after refreeze (`648dd3675`, `4e43bcdca`, `5965b023a`).
- Bootstrap first-paint: inactive character shells and lazy prompt templates must
  not render as complete-but-empty (`38949dbaf`, `3d800d2ec`, `f0c7f7320`). Tier 2.
- Send/swipe/regenerate: transcript reflects the new turn; swipe buffer paints,
  not just reconstructs. This covers the gap left by
  `rerollSwipePersistence.spec.ts`.
- Settings rows: `SettingRenderer` and wrappers; a saved value re-renders the row,
  and rollback paints the revert. This enforces the Visible State Contract's
  optimistic+rollback rule.
- Import/confirmation: post-import confirmation state and starter-chat rendering
  (`4a57c6476`, `7bef0dbfd`, `f3b1c81e8`).
- Silent fallbacks: missing custom-HTML template/module collection renders a
  visible correct fallback, never a silent blank (`347f063ed`, `127fbe6dc`,
  `ccfc70818`).

---

## 11. Deliverables

1. A DOM-oracle test helper: state-vs-DOM differential reusable across Tier 1 and
   Tier 2, built on `__RISU_FASTIFY_BROWSER_SMOKE__.getDatabaseSnapshot()` and the
   `data-risu-*` selectors.
2. Phase 0 tests for journeys 1-4, committed with the inverse-fix proof result.
3. A findings register using the section 7 format, with severity tallies.
4. A short remediation plan grouping findings by root family from section 5, so
   fixes target generators rather than instances. Mirror the `docs/plan/` phase
   structure.
5. Recommendation on which surfaces should graduate the Visible State Test
   Contract from policy to an enforced gate.

---

## 12. Quick reference

```bash
pnpm dev:agent                              # auth-bypass full stack (6418/6419), Tier-2 driving
pnpm smoke:fastify-browser                  # build + Playwright (Tier-2 harness pattern)
pnpm exec vitest run <file>                 # Tier-1 happy-dom DOM-oracle tests
pnpm coverage:ui-map                        # focused UI coverage map
rg "<uid>" data/trace/*.jsonl               # correlate visible bug <-> API call (X-Request-UID)

# TypeScript (server is strict; run after touching client types)
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
