# Frontend Performance Deep-Clone Narrowing Plan

Date: 2026-06-03

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

- [`../frontend-performance-audit.md`](../frontend-performance-audit.md) seeded
  the findings, costs, hot-path frequency, severity, fixes, and clone-site
  inventory. [`status.md`](status.md) records current phase state.
- `src/ts/server/projectionWriteGuard.svelte.ts` owns the guard
  (`withTrustedServerProjectionWrite`, `snapshotServerProjectionValue`,
  `createReadOnlyServerProjection`, `readOnlyServerProjectionSources`).
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
- [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md),
  [`../structure/frontend.md`](../structure/frontend.md), and
  [`../structure/data-and-events.md`](../structure/data-and-events.md) own the
  guard, bridge-watcher, hydration, revision, and active-writer references.
- The codebase remains the source of truth when docs drift.

## Current Baseline

The audit found two clone patterns and one amplifier:

- `cloneJsonValue` = `JSON.parse(JSON.stringify(...))` is redefined per file
  (`chatCommands.ts`, `characterCommands.ts`, `lorebookBridge.svelte.ts`,
  `scriptDefinitionBridge.svelte.ts`, `CharConfig.svelte`, ...). The
  `current*StateSnapshot()` helpers built on it often clone whole collections for
  rollback that is usually discarded.
- `safeStructuredClone` clones full transcripts or full characters on reroll,
  swipe, and `runTrigger` paths, even when only a tail or active chat is needed.
- `withTrustedServerProjectionWrite` adds two whole-`Database` clones to every
  guarded write (`projectionWriteGuard.svelte.ts:115/119`). This affects about
  100 sites, including streaming, completion, SSE apply, chat open, and
  prompt-template editing.

Empirical baseline (from the audit, reproduced on a 61 MB hydrated DB): one
guarded write takes about 255 ms (entry clone ~125 ms + refreeze clone ~130 ms);
a few-MB DB is still tens of ms per call. `currentChatStateSnapshot()` /
`currentCharacterStateSnapshot()` scale with total hydrated history across all
opened characters, not the single row mutated.

The reference fix `c9e728b1` narrowed character select to a scalar snapshot. This
plan applies the same shape to message, send, streaming, trigger, reroll,
watcher, and editor paths, then removes the guard amplifier beneath them.

## Prerequisites

Phase 0 lands the shared prerequisites before any hot-path call site is narrowed:

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
  debounce projection writes and avoid whole-template stringify checks.
- [6. Lorebook Watcher Scope](phases/phase-6-lorebook-watcher-scope.md): scope
  lorebook collection to the mounted panel.
- [7. Opportunistic Cleanups](phases/phase-7-opportunistic-cleanups.md):
  shallow-spread, memoize, or remove low-priority clone sites.
- [8. Verification Budgets](phases/phase-8-verification-budgets.md): keep
  clone-cost gates complete and self-checking.

## Execution Cursor

Nothing is implemented yet. Start with Phase 0, then Phase 1, then Phase 2.
Phases 3-7 can land in any order once their prerequisites exist. Phase 8 is the
standing verification layer.

For every narrowed path: capture a narrow rollback, restore only mutated fields,
keep full clones for restructures, and add a regression test proving the path
does not clone every character.

## Not In This Plan

- Replacing the optimistic-write / command / event / revision model or the
  projection/bootstrap/hydration model with a new sync model.
- Re-architecting how hydrated `message[]` histories accumulate into
  `DBState.db.characters`; the plan reduces what is cloned, not where state
  lives.
- The candidates the audit investigated and rejected or downgraded - they are
  recorded under "Investigated but not flagged" in
  [`active-risk-analysis.md`](active-risk-analysis.md) so future readers do not
  re-open them:
  - `buildMemoryWindow.ts:139` full-characters clone - the heavy branch is the
    local assembler, dead on the default `server` send route (latent foot-gun,
    not a live freeze).
  - `request.ts:247` full-prompt double clone - skipped on the default server
    route; the hot callers carry small bounded prompts.
  - `lorebook.svelte.ts:166` combined-lorebook clone - local-assembler only; a
    by-reference fix would be a correctness regression.
  - `chatTemplate.ts:40` instruct-template prompt clone - context-bounded text,
    single-digit ms, opt-in provider.
  - `ChatBody.svelte:79` `isEqual` over the simpleCharacter arrays - shared
    references hit the `===` fast path; benchmarked at 0.20 ms.
  - `PersonaSettings.svelte:68` personas double clone - bounded config; sub-ms,
    a cheap cleanup carried as a Phase 7 optional, not a freeze.
  - `protocolDiagnostics.ts:159` `structuredClone` - small bounded counters
    object.
- Changing message-store, `hypaV3Data`, or alternate split-store semantics.
