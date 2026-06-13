# Findings Register

Format per AUDIT-PLAN.md §7. Confirmation bar (§8): a finding is confirmed only when its
repro test drives the transition through the **real DOM**, is **red on the current tree**,
and verifies the backing **store is correct**. Hypotheses without a red DOM repro are not
findings.

## Severity tally

| Severity | Count | IDs |
| --- | --- | --- |
| H | 0 | — |
| M | 1 (**FIXED**) | UIA-001 |
| L | 0 | — |
| I | 0 | — |
| Routed off-audit (logic/value track) | 2 | UIA-R1, UIA-R2 |
| Verified-no-divergence (regression-guard opportunities) | 7 | UIA-N1 … UIA-N7 |

UIA-001 was confirmed with a red DOM repro and then **fixed in this audit** (see its Status
line); the repro now stands as a green regression guarantee.

The tree is freshly patched: the last ~15 commits fixed exactly these UI bug classes with
DOM tests, so most inventory areas came back **already-covered**. The audit reports that
honestly rather than manufacturing findings. One genuine, previously-uncovered
rendered-state divergence was confirmed with a red repro.

---

## UIA-001 — Bootstrap shell greeting render crashes on `alternateGreetings.length`

```
ID:            UIA-001
Severity:      M
Status:        FIXED (this audit) — DefaultChatScreen.svelte gates the greeting block on
               `!isServerCharacterShell(currentCharacter)`; a shell renders no greeting (the
               load state covers it) until the row hydrates. The repro test flipped from a
               red `it.fails` to a green `it`. Tier-2 journeys re-verified after rebuild.
Journey:       A user keyboard-navigates (prev/next character hotkey) to an INACTIVE
               character while a chat is open. That character arrived from the server as a
               bootstrap shell (the projection strips alternateGreetings/firstMessage for
               non-current rows). The chat screen paints its greeting before async shell
               hydration lands.
Transition:    selectedCharID flips to a shell index AND the route still carries a chatId
               (activeChatOpen stays true), so DefaultChatScreen renders the greeting bubble
               of a still-shell character.
Driver:        Real keyboard hotkey prevChar/nextChar (hotkey.ts:117/135) sets selectedCharID
               directly; hydration is only a fire-and-forget async fetch via the
               selectedCharID.subscribe handler (characterShellHydration.svelte.ts:14). The
               App route-sync $effect (App.svelte:95-107) synchronously keeps the chat route,
               so activeChatOpen flips true on the shell before the fetch resolves.
               (Repro test mounts the real DefaultChatScreen with a faithful shell + chat
               route — the same rendered state, without needing to win the race.)
DOM observed:  The greeting region throws a TypeError ("Cannot read properties of undefined
               (reading 'length')") while evaluating the <Chat> props; the greeting bubble
               [data-chat-index="-1"] never paints (the render subtree aborts).
DOM expected:  The greeting region renders without crashing (a greeting once hydrated, or a
               graceful empty/loading state on a shell) — never a hard render throw.
Store value:   DBState.db.characters[selectedCharID] is a CORRECT bootstrap shell
               (isServerCharacterShell === true; alternateGreetings === undefined because it
               is not in BOOTSTRAP_CHARACTER_SHELL_FIELDS). -> classify: store CORRECT (in
               scope). The identical DOM-driven render goes GREEN once the row hydrates
               (control test), so the change that fixes it is hydration/guarding, not a value.
Root family:   Hydration shell rendered as complete (§5).
Repro test:    src/lib/ChatScreens/DefaultChatScreen.shellGreeting.dom.test.ts
               - "renders a bootstrap shell without crashing on alternateGreetings.length"
                 (green after the fix; was a red `it.fails` repro before it).
               - "paints the greeting bubble once the character is hydrated" (control, green).
               Faithful Chat stub: DefaultChatScreen.shellGreetingStub.svelte (reads
               altGreeting/totalPages, because Svelte 5 props are lazy — see §2 of
               phase1-gap-analysis.md).
Tier:          1
Fix applied:   Option (b). DefaultChatScreen.svelte now gates the greeting block on
               `!isServerCharacterShell(currentCharacter)` (import added from
               storage/database.svelte). The unguarded reads at the former :1060-1090 are no
               longer reached while the row is a shell; the existing load state covers the
               greeting slot until hydration lands. Chosen over option (a) (`?.` on each read)
               because it also prevents a complete-but-empty greeting flash and covers any
               future unguarded shell read in that block. loadPages regression test + all
               three Tier-2 journeys re-verified green after the rebuild.
```

Notes on severity (honest): rated **M**, not **H**, because it requires a timing race on a
specific input path (keyboard prev/next-char to an *inactive* shell while a chat route is
open), and the async hydration fetch eventually completes (re-select/reload recovers). It
leans toward **H** in that it was a hard render crash with no graceful degrade, and the
unguarded reads were a latent landmine for any future code path that paints a shell — which
is why the fix gates the whole greeting block rather than patching individual reads.

---

## Routed off this audit (logic/value track — store itself is wrong/incomplete)

These are genuine product issues but are NOT rendered-state divergence (the DOM faithfully
renders an incomplete/un-persisted store), so per §2/§4 they belong to the static-test track.

```
ID:            UIA-R1
Title:         Chat fork has no optimistic paint and nothing projects the server result.
Why off-audit: forkChat (SideChatList.svelte:135-147) does no optimistic insert; the
               fork-chat command success path (commands.ts ~2251-2280) touches no store, and
               the chat-metadata bridge watcher never inserts new rows. So
               DBState.db.characters[].chats never gains the forked row — the store is
               incomplete and the DOM correctly reflects it (no correct-store-vs-stale-DOM
               divergence). Real bug, but value/logic track.
```

```
ID:            UIA-R2
Title:         Four custom-quote rows never persist and have no rollback.
Why off-audit: display.{leading,trailing}{Double,Single}Quote rows never issue a server
               PATCH (serverPatchKeyForItem only matches display.customQuotes*,
               setting/utils.ts ~155-158). The DOM correctly matches the un-persisted local
               store (classifyDifferential -> dom-matches-store). Persistence gap -> value track.
```

---

## Verified-no-divergence (record as solid; regression-guard opportunities, no red repro)

Each was probed and found correct on the current tree. Listed so the register records the
coverage and the optional hardening, per the plan's "record verified-no-divergence" intent.

| ID | Area | Verdict / why solid | Optional hardening |
| --- | --- | --- | --- |
| UIA-N1 | Chat lifecycle (select/create/delete) | Covered: `SideChatList.svelte.test.ts:622,646,681,708,738,767,797` assert painted `data-risu-chat-selected`/row presence after optimistic ops + rollback. | Add a Tier-2 chat-switch journey (the Tier-1 suite mocks the router); `phase0VisibleState.spec.ts` Journey 1 is that test. |
| UIA-N2 | Send/swipe/regenerate paint | No divergence: a probe confirmed refreeze → `currentChat` `$derived` → `chatRows` `$derived.by` → keyed `{#each}` repaints; `rerollSwipePersistence.spec.ts` asserts the live swipe-back row. | The Tier-1 full-mount stubs `Chat.svelte`, so the `{@html}` repaint seam is unasserted; residual risk is real-browser stream-coalescer *timing* (Tier-2 only). |
| UIA-N3 | Settings rows (SettingRenderer wrappers) | No divergence: a 409 rollback repaints (sync `$effect localValue = getSettingValue(...)`, e.g. `SettingCheck.svelte:18-20`). | No wrapper-level DOM test exists; add one as a regression guard. |
| UIA-N4 | Import / confirmation gate | Covered: `chatGenerationSettingsControls.test.ts:408,493,677` assert post-import `configured:false` labels + per-row projection repaint; `phase0VisibleState.spec.ts:119` drives a real import refreeze. | — |
| UIA-N5 | Silent fallbacks (custom-HTML / module collection) | Well-covered: `Chat.customHtml.test.ts:363-371` (missing template → standard layout in DOM), `ModuleSettings.svelte.test.ts:211-276` (`[data-risu-module-row]`). | `ModuleSettings.svelte:100` reads `.length` un-`?.`-guarded, but `setDatabase` defaults `modules ??= []`, so safe. |
| UIA-N6 | Projection-narrowing: persona / prompt-items / import refreeze | No divergence: narrowed fields are inside scope and read reactively; whole-root reassignment (`setDatabaseLite` → `DBState.db = data`) is a tracked `$state` write the picker `$derived.by` re-reads (proven by `chatGenerationSettingsControls.test.ts:622,677`). | — |
| UIA-N7 | Projection-narrowing: loadout (`lastLoadedLoadoutName`, favorite grouping) | No divergence today: `lastLoadedLoadoutName` is in the loadout projection (co-fix `8be30a1dc`) and read directly by `CustomSidebar.svelte:21`; favorite grouping mutates a Svelte deep-proxy in place (tracked). | `LoadoutModal.svelte` has **zero `data-risu-*` selectors and no DOM test** — add `data-risu-loadout-favorite` + key the group lists, then a guard. Both projection-narrowing fix options recorded in `remediation-plan.md` (Family D). |

---

## Phase 0 gate-validation tests (not findings — they validate the apparatus)

The four Phase 0 journey tests are GREEN on the current tree by design; their value is the
inverse-fix proof (`phase0-acceptance-gate.md`). They are listed here for completeness:

| Journey | Test | Tier |
| --- | --- | --- |
| J1 chat-switch → picker repaint | `phase0VisibleState.spec.ts` | 2 |
| J2 optimistic toggle paint | `phase0Journey2TogglePaint.dom.test.ts` (paint) + `phase0VisibleState.spec.ts` (settle) | 1 / 2 |
| J3 sidebar tab stability | `phase0VisibleState.spec.ts` | 2 |
| J4 grouped toggle render | `phase0Journey4Grouping.dom.test.ts` | 1 |
