# Phase 1+ Inventory — Gap Analysis

Method: a read-only fan-out mapped each Phase 1+ inventory area (AUDIT-PLAN.md §10) for
rendered-state-divergence gaps; every high/medium candidate then ran an adversarial
"try-to-refute" verification (is it a real DOM gap? is the store provably correct? is it
already covered?). Candidates that survived were turned into a **real probe test** and run
— a candidate is only a finding if its DOM-driven repro is red on the current tree with a
correct store.

Result: **7 areas mapped, 19 candidates, 4 reached adversarial verification, 1 confirmed
finding** (UIA-001, written up in `findings-register.md`). Everything else is recorded as
verified-no-divergence or routed to the logic/value track.

## 1. Per-area coverage summary

| Area | Verdict | Key existing DOM coverage |
| --- | --- | --- |
| Chat lifecycle (SideChatList create/delete/select/fork) | covered (cross-component integration is the only gap) | `SideChatList.svelte.test.ts` asserts painted `data-risu-chat-selected` / row presence after optimistic create/delete/select **and** rollback (`:622,646,681,708,738,767,797`). Gap: the suite mocks the router, so the joined click→route→repaint path is unasserted at Tier 1 — closed by `phase0VisibleState.spec.ts` Journey 1 (Tier 2). |
| Bootstrap first-paint (inactive shells, lazy templates) | **partial — REAL GAP (UIA-001)** | Store-level only: `bootstrap.test.ts`, `characterShellHydration.test.ts`, `promptTemplateHydration.test.ts`. The one real-component mount (`DefaultChatScreen.loadPages.test.ts`) only uses fully-hydrated fixtures (`alternateGreetings:[]` always present) — never a shell. |
| Send / swipe / regenerate transcript paint | covered for value; timing is Tier-2-only | `rerollSwipePersistence.spec.ts` asserts the live swipe-back row repaint + post-reload regenerate. A probe confirmed the refreeze→`$derived`→keyed-`{#each}` chain repaints. Residual risk is real-browser stream-coalescer *timing*, not a confirmed divergence. |
| Settings rows (SettingRenderer + wrappers) | untested-but-correct | A mounted 409-rollback probe repaints correctly (sync `$effect localValue = getSettingValue(...)`). No wrapper-level DOM test exists → regression-guard opportunity. |
| Import / confirmation (configured gate, starter chats) | covered | `chatGenerationSettingsControls.test.ts:408,493,677`; `phase0VisibleState.spec.ts:119` drives a real import refreeze. |
| Silent fallbacks (missing custom-HTML / module collection) | well-covered | `Chat.customHtml.test.ts:363-371`; `ModuleSettings.svelte.test.ts:211-276`. |
| Projection-narrowing tax (§5) | untested-but-correct (3 regression-guard candidates) | Narrowed fields are inside scope and read reactively; whole-root reassignment is a tracked `$state` write the picker `$derived.by` re-reads. See §3. |

## 2. Confirmed probe

**UIA-001** (rank 1, and the only candidate that passed the gate): the bootstrap-shell
greeting render crash. Full write-up and repro in `findings-register.md`. Evidence:
`DefaultChatScreen.svelte:1060,1066,1072,1082,1090` read `alternateGreetings.length` (and
index into it) with no optional chaining and no shell guard; `alternateGreetings` is not in
`BOOTSTRAP_CHARACTER_SHELL_FIELDS` (`server/fastify/src/repository.ts:1432-1451`).

Probe-build learning worth recording: the first probe attempt did **not** reproduce because
the existing `Chat.svelte` test stub ignores the `altGreeting`/`totalPages` props, and
Svelte 5 props are **lazy** — an unread prop expression is never evaluated, so the unguarded
parent read never fired. The real `Chat.svelte` *does* read `altGreeting` (`:1070-1071`) and
`totalPages` (`:1079`), so production evaluates the expression and crashes. The probe uses a
faithful stub (`DefaultChatScreen.shellGreetingStub.svelte`) that reads those props.

## 3. Projection-narrowing candidates — both fix options (none confirmed as divergence)

All three are untested-but-correct today (regression guards, not findings). Per AUDIT-PLAN
§5, both fix options are recorded:

- **Loadout `lastLoadedLoadoutName`** (co-fixed into the loadout projection `8be30a1dc`,
  consumed by `CustomSidebar.svelte:21`):
  - Fix A: keep `lastLoadedLoadoutName` in the loadout projection (already done).
  - Fix B: derive the button from the always-shipped `loadouts` collection so it depends on
    no out-of-scope scalar.
- **LoadoutModal favorite grouping** (in-place `targetLoadout.favorite` mutation feeding a
  `{#each getFavoriteLoadouts()}` group):
  - Fix A: reassign `DBState.db.loadouts` (whole-array) in `toggleFavorite` instead of
    mutating in place.
  - Fix B: add a `data-risu-loadout-favorite` attribute and key the group lists so any
    regression becomes testable (LoadoutModal currently has no `data-risu-*` selectors).
- **Whole-DBState refreeze repaints picker**:
  - Fix A: ensure `resolveActiveChatGenerationSettings`'s `$derived` re-tracks the reassigned
    `DBState.db` root (it does today).
  - Fix B: key the picker on a value the refreeze reassigns.

## 4. Refuted / out-of-scope (recorded so they are not re-opened)

- `chat-fork-no-optimistic-paint` → **logic/value track** (UIA-R1): the store never gains the
  forked row; the DOM faithfully renders the incomplete store. Real bug, wrong audit.
- `customquotes-no-persist` → **logic/value track** (UIA-R2): four quote rows never PATCH; DOM
  matches the un-persisted store.
- `select-real-navigate-to-chatpage-uncovered` → **refuted (covered)**: `selectChat` takes the
  navigate path xor the optimistic-flip path (mutually exclusive), so the claimed `chatPage`
  collision cannot occur; `SideChatList.svelte.test.ts:622-644` already asserts painted-DOM-
  tracks-chatPage.
- `UIA-IMPORT-1` (refreeze fails to repaint picker) → **refuted (covered)**: root reassignment
  is a tracked `$state` write; two mounted tests already prove the picker re-tracks.
- `SSR-1/2/3`, `settings-rollback`, `settings-select-segmented`, `SF-1/2/3`,
  `UIA-PNT-1/2/3`, `UIA-IMPORT-2` → verified-no-divergence (see `findings-register.md`
  UIA-N1…N7).

## Bottom line

- **Fixed in this audit:** 1 finding — UIA-001 (Tier 1, real DOM gap, correct store,
  uncovered) — gated the greeting block on `!isServerCharacterShell(currentCharacter)`; repro
  flipped from red to a green guarantee. See `findings-register.md` / `remediation-plan.md`.
- **Graduate to a gate:** the priority surfaces in `visible-state-contract-recommendation.md`
  (notably replace the `App.routeEffect` source-scan with the Tier-2 behavioral test, and add
  the Tier-2 chat-switch journey).
- **Route off-audit:** UIA-R1 (fork optimistic paint), UIA-R2 (custom-quote persistence).
- **Optional regression guards:** UIA-N1…N7 (add `data-risu-*` selectors to LoadoutModal
  first; no red test expected).
