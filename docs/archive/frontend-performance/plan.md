# Frontend Performance Deep-Clone Narrowing Plan

Date: 2026-06-04

## Goal

Remove deep-clone and full-state-serialize costs from frontend hot paths. Each
path should clone only the state it mutates, while preserving optimistic writes,
rollback correctness, projection immutability, command/event/revision behavior,
and rendered output.

End state:

- The projection write guard stops cloning the whole `Database` per write.
- Hot-path rollbacks use scalar, single-row, or single-chat snapshots.
- Watchers capture rollback lazily and only for changed rows.
- Cheap wins land: reroll tail clone, redundant clone removal, and
  `runTrigger` early return before cloning.
- Prompt-template editing stops cloning/stringifying the whole template per
  keystroke.
- Low-priority clone sites are shallow-copied, scoped, memoized, or removed.
- Every narrowed path has a regression test proving it does not clone the whole
  characters array or whole `Database`.

## Boundary Sources

- [`../../frontend-performance-audit.md`](frontend-performance-audit.md) seeded
  the findings, costs, hot-path frequency, severity, fixes, and clone-site
  inventory. [`status.md`](status.md) records current phase state.
- `src/ts/server/projectionWriteGuard.svelte.ts` owns the Phase 1 guard
  (`withTrustedServerProjectionWrite`, `createReadOnlyServerProjection`,
  `resolveServerProjectionSource`, and the read-only/working-copy WeakMaps).
- `src/ts/chatCommands.ts`, `src/ts/characterCommands.ts` own the
  `current*StateSnapshot` / `restore*State` families and the reference
  `CharacterSelectionSnapshot`.
- `src/ts/server/lorebookBridge.svelte.ts`,
  `src/ts/server/scriptDefinitionBridge.svelte.ts`,
  `src/ts/server/chatBridge.svelte.ts` own the snapshot helpers and reactive
  bridge watchers.
- `src/ts/process/postGeneration/streamResponse.ts`,
  `nonStreamResponse.ts`, `src/ts/process/rerollNavigation.svelte.ts`,
  `src/ts/process/triggers.ts`, `src/ts/parser/chatVar.svelte.ts`,
  `src/ts/process/command.ts` own the generation, reroll, trigger, and CBS write
  paths.
- `src/lib/ChatScreens/DefaultChatScreen.svelte`,
  `src/lib/ChatScreens/Chat.svelte`,
  `src/lib/Setting/Pages/PromptSettings.svelte`,
  `src/lib/Setting/lorepreset.svelte` own the send, per-message, and
  editor-keystroke call sites.
- [`../../structure/server-projection-and-bridges.md`](../../structure/server-projection-and-bridges.md),
  [`../../structure/frontend.md`](../../structure/frontend.md), and
  [`../../structure/data-and-events.md`](../../structure/data-and-events.md) own the
  guard, bridge-watcher, hydration, revision, and active-writer references.
- The codebase remains the source of truth when docs drift.

## Current Baseline

The seed audit found two clone patterns and one amplifier:

- `cloneJsonValue` = `JSON.parse(JSON.stringify(...))` is redefined per file
  (`chatCommands.ts`, `characterCommands.ts`, `lorebookBridge.svelte.ts`,
  `scriptDefinitionBridge.svelte.ts`, `CharConfig.svelte`, ...). The
  `current*StateSnapshot()` helpers built on it often clone whole collections for
  rollback that is usually discarded.
- `safeStructuredClone` clones full transcripts or full characters on reroll,
  swipe, and `runTrigger` paths, even when only a tail or active chat is needed.
- Before Phase 1, `withTrustedServerProjectionWrite` added two whole-`Database`
  clones to every guarded write. The current code has removed that amplifier via
  copy-on-write proxy unwrap/rewrap; the remaining broad clones are the snapshot
  families and lower-priority transcript/editor clones below.

Empirical seed baseline (from the audit, reproduced on a 61 MB hydrated DB):
before Phase 1, one guarded write took about 255 ms (entry clone ~125 ms +
refreeze clone ~130 ms). The current guard proof shows zero clone-primitive calls
for a one-field guarded write. The legacy full-state snapshot helpers still scale
with total hydrated history, but Phase 2 has moved the Critical/High message,
scriptstate, reroll, character, and global-lorebook hot callers onto scoped
snapshots, Phase 4 moved the script-definition watcher onto a scoped per-row
rollback, and Phase 5 narrowed the prompt-template editor keystroke to an
in-place single-item write plus a revision-gated reconcile. Remaining broad
runtime work is Phase 6's DB-wide lorebook watcher plus the Phase 7 low-priority
cleanup inventory. Genuine restructures/imports keep broad snapshots by design
unless a later focused slice says otherwise.

The reference fix `c9e728b1` narrowed character select to a scalar snapshot. With
the guard amplifier removed by Phase 1, Phase 2 applied the same shape to the main
snapshot-family hot paths. Phase 3 landed the cheap reroll and `runTrigger` wins;
`48d473dc` then fixed the `runTrigger` `setVar`/`v2SetVar` direct projection write
that the Phase 3 tests exposed. Phase 4 applied the same scoped-rollback shape to
the script-definition watcher, and Phase 5 narrowed the prompt-template editor
keystroke (in-place item write + revision-gated reconcile; debounce coalescing
deferred). The remaining planned phases are the lorebook watcher scope reduction,
low-priority cleanups, and gate completeness.

## Prerequisites

Phase 0 has landed the shared prerequisites before any Phase 2 hot-path call
site is narrowed:

1. Snapshot kit: scalar, single-row, and single-chat snapshot+restore pairs in
   `chatCommands.ts`, `characterCommands.ts`, and `lorebookBridge.svelte.ts`,
   mirroring `CharacterSelectionSnapshot` / `restoreCharacterSelection`
   (`currentChatScopedSnapshot`/`restoreChatScopedState`,
   `ChatScriptstateSnapshot`/`restoreChatScriptstate`,
   `CharacterRowSnapshot`/`restoreCharacterRow`,
   `currentGlobalLorebookStateSnapshot`/`restoreGlobalLorebookState`, plus reuse
   of the existing `scopedLorebookStateSnapshot`).
2. Clone-cost regression harness: a reusable test helper that asserts snapshots
   omit full collections and hot paths do not invoke whole-DB or
   whole-characters clone primitives.
3. Rollback-correctness rule: a narrowed rollback must restore exactly what the
   command mutates and must not clobber unrelated concurrent edits the
   full-array restore would have wiped (the reference fix's second test).
4. Reserve-the-full-clone rule: keep full-collection snapshots for
   create/delete/reorder/fork. Narrowing stops hot paths from reaching them.

## Invariants

- Optimistic writes still apply immediately; the server command, revision
  baseline, single revision bump, and single command event are unchanged.
- A narrowed rollback restores every field the command mutates and nothing else;
  it never re-clones or re-writes unrelated rows (the
  `restoreCharacterSelection` correctness property).
- The projection write guard keeps its recursive immutability guarantee: a
  copy-on-write / proxy unwrap-rewrap that drops the defensive clone must still
  hand readers a read-only projection and must mint a new identity so Svelte
  reactivity fires.
- Change-detection snapshots inside reactive `$effect`s must produce the same
  diff/dispatch decisions; only the cost of producing them changes.
- Rendered output, prompt assembly bytes, trigger/CBS results, and persisted
  state are byte-identical before and after each slice.
- Never deep-clone the whole characters array, the whole `Database`, or a full
  message history on a scalar-only or hot path; reserve the full clone for
  genuine restructures.

## Phase Overview

- [0. Baseline Foundations](phases/phase-0-baseline-foundations.md): add the
  snapshot kit and clone-cost harness.
- [1. Projection Write Guard](phases/phase-1-projection-write-guard.md): stop
  whole-`Database` clones per guarded write.
- [2. Snapshot-Family Hot-Path Narrowing](phases/phase-2-snapshot-family-narrowing.md):
  route Critical/High `current*StateSnapshot` call sites through the narrow kit.
- [3. Cheap High-Confidence Wins](phases/phase-3-cheap-wins.md): reorder/remove
  reroll clones and return early in `runTrigger`.
- [4. Script-Definition Watcher](phases/phase-4-script-definition-watcher.md):
  avoid full characters/modules reads per watcher fire.
- [5. Prompt-Template Editor Keystroke Costs](phases/phase-5-prompt-template-keystroke.md):
  write one edited item synchronously, roll back one item on command failure, and
  revision-gate draft reconciliation; debounce coalescing remains deferred.
- [6. Lorebook Watcher Scope](phases/phase-6-lorebook-watcher-scope.md): scope
  lorebook collection to the mounted panel.
- [7. Opportunistic Cleanups](phases/phase-7-opportunistic-cleanups.md):
  shallow-spread, memoize, or remove low-priority clone sites.
- [8. Verification Budgets](phases/phase-8-verification-budgets.md): keep
  clone-cost gates complete and self-checking.

## Execution Cursor

Phases 0-5 are implemented. Phase 1's batching slice and Phase 5's debounce
coalescing remain deferred optional sub-steps. Start runtime work with Phase 6 or
Phase 7; Phase 8 remains the planned clone-cost gate-completeness layer.

For every narrowed path: capture a narrow rollback, restore only mutated fields,
keep full clones for restructures, and add a regression test proving the path
does not clone every character.

## Not In This Plan

- Replacing the optimistic-write / command / event / revision model or the
  projection/bootstrap/hydration model with a new sync model.
- Re-architecting how hydrated `message[]` histories accumulate into
  `DBState.db.characters`; the plan reduces what is cloned, not where state
  lives.
- Re-opening candidates the audit already rejected or downgraded. The canonical
  list lives under "Investigated But Not Flagged" in
  [`active-risk-analysis.md`](active-risk-analysis.md).
- Changing message-store, `hypaV3Data`, or alternate split-store semantics.
