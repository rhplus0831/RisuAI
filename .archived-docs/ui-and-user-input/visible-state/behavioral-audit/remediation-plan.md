# Remediation Plan — grouped by root family

The plan (§11.4) asks for fixes targeted at *generators* (the §5 root families) rather
than instances, mirroring the `docs/plan/` phase structure. This document groups every
confirmed finding and every verified gap by family, so one fix closes a class of bugs.

Status legend: **CONFIRMED** = red DOM-oracle test on the current tree with a correct
store; **GATE-VALIDATED** = the family already has a fix on the current tree, and a
DOM-oracle test pins it (proven by the inverse-fix gate); **OPEN-PROBE** = a candidate the
Phase 1+ analysis flagged as worth a real probe (see `findings-register.md` for the
red/green verdict once the probe is written).

---

## Family A — Grouping / structural derivation

- **Generator**: a `{#each}`/grouping derivation in a component drifts from the
  layout-producing helper, so structural rows (groups, dividers, captions) stop painting
  even though the helper still computes them.
- **GATE-VALIDATED**: `Toggles.svelte` grouped-accordion rendering vs
  `resolveDisplayedSidebarToggles` (pinned by `phase0Journey4Grouping.dom.test.ts`;
  inverse-fix proof in `phase0-acceptance-gate.md`).
- **Fix policy**: any component that renders a helper-derived layout tree must have a
  Tier-1 DOM-oracle test asserting the painted structure, not just a helper test asserting
  the computed tree.

## Family B — `$effect`/`untrack` swallow (refreeze resets unrelated UI)

- **Generator**: an `$effect` that calls a store-reading routine without `untrack` tracks
  incidental state (e.g. `DBState.db`), so an unrelated projection refreeze re-runs it and
  clobbers UI not encoded in its inputs (sidebar tab, open panel, selection).
- **GATE-VALIDATED**: `App.svelte` route-application effect →
  `untrack(applyRouteToStores)` (pinned by `phase0VisibleState.spec.ts` Journey 3;
  inverse-fix proof in `phase0-acceptance-gate.md`). Note the bug only manifests on a
  **full resync** (`forceServerProjectionResync`), not a fine-grained merge.
- **Fix policy**: every `$effect` that calls a routine reading `DBState.db` / projection
  state but is keyed off a narrower input (a route, a selection) must `untrack` the call,
  and must carry a Tier-2 behavioral test (not a source-scan) proving an unrelated refreeze
  does not reset visible UI.

## Family C — Optimistic paint / rollback

- **Generator**: an optimistic command path writes a narrowed scalar; the rendered surface
  either does not paint the optimistic write, or paints it and then wrongly reverts when
  the projection reconcile lands.
- **GATE-VALIDATED (paint)**: jailbreak/sidebar toggle optimistic paint
  (`phase0Journey2TogglePaint.dom.test.ts`); settle across the refreeze
  (`phase0VisibleState.spec.ts` Journey 2). Rollback paint is already covered by
  `chatGenerationSettingsControls.test.ts` ("restores visible active-chat controls when a
  save fails").
- **Fix policy**: per the Visible State Contract, any optimistic write asserts BOTH the
  visible optimistic change and the visible rollback.

## Family D — Projection write not observed / narrowing tax

- **Generator** (§5 lead): the perf campaign narrowed optimistic writes/projections to
  single scoped fields. A rendered surface that depends on a field **outside** the narrowed
  scope paints stale, because the narrow projection never updates that field.
- For each such case the plan requires recording **both** fix options:
  1. Include the field in the narrow projection (cheap, keeps the surface as-is); or
  2. Make the rendered surface depend only on projected fields (keeps the projection narrow).
- **Findings**: populated from the Phase 1+ analysis — see `findings-register.md` and
  `phase1-gap-analysis.md`. Each narrowing finding lists both options.

## Family E — Keyed `{#each}` mis-key

- **Generator**: a keyed list whose key does not track the identity that actually changed,
  so a row's content updates without re-render, or a row wrongly remounts.
- **Findings**: see `findings-register.md` (chat-lifecycle / list areas).

## Family F — Hydration shell rendered as complete

- **Generator**: a half-hydrated projection shell (inactive character, lazy prompt
  template) renders as final/blank/partial — or **crashes** — before hydration lands,
  because a renderer assumes a complete character.
- **CONFIRMED & FIXED — UIA-001** (severity M): `DefaultChatScreen.svelte` (formerly
  :1060,1066,1072,1082,1090) read `alternateGreetings.length` (and indexed into it) with no
  optional chaining and no shell guard. On a correct bootstrap shell (`alternateGreetings`
  stripped), the greeting render threw. Reachable via the keyboard prev/next-char hotkey to
  an inactive shell while a chat route is open (hydration is a fire-and-forget async fetch).
  Repro: `src/lib/ChatScreens/DefaultChatScreen.shellGreeting.dom.test.ts` (now a green
  guarantee + green hydrated control). Full entry in `findings-register.md`.
  - **Fix applied — option (b)**: the greeting block is gated on
    `!isServerCharacterShell(currentCharacter)`, so a shell shows the existing load state and
    never reaches the unguarded reads (also prevents a complete-but-empty greeting flash and
    covers any future unguarded shell read in that block).
  - Alternative considered — option (a): guard each read (`alternateGreetings?.length ?? 0`).
    Not chosen: it leaves a blank greeting painted during the shell window.
- **GATE context**: the shell *mechanism* was recently introduced/fixed by `38949dbaf`,
  `3d800d2ec`, `f0c7f7320` (those land the shell + hydration); UIA-001 is a renderer that
  was not updated to tolerate the shell intermediate state. Only the active-character
  render path was guarded.

---

## Sequencing (mirrors `docs/plan/` phasing)

1. **Phase 0 (done)** — proof slice + gate. Families A and B gate-validated; C paint+settle
   covered.
2. **Phase 1 — graduate the contract** for the priority-1/2 surfaces
   (`visible-state-contract-recommendation.md`): replace the `App.routeEffect` source-scan
   with the behavioral Tier-2 test; add the Tier-2 chat-switch journey.
3. **Phase 2 — close confirmed findings** by family (each fix carries its red→green
   DOM-oracle test). Detailed per-finding entries land in `findings-register.md`.
4. **Phase 3 — transcript-paint coverage** (Family C/E): add the rendered-bubble Tier-2
   test the `rerollSwipePersistence.spec.ts` buffer-only assertion leaves open.
