# Frontend Performance Deep-Clone Narrowing Plan

Date: 2026-06-03

## Goal

Remove the deep-clone / full-state-serialize costs the audit found on the
frontend hot paths so that each path clones only the state it logically touches.
Preserve optimistic-write behavior, optimistic-rollback correctness, projection
guard immutability, the command/event/revision contract, and rendered output
byte-for-byte.

End state:

- The trusted projection write guard no longer deep-clones the whole `Database`
  on every guarded write; the per-token streaming write, non-stream completion,
  SSE apply, chat-open hydration, and prompt-template keystroke stop paying the
  full-DB clone.
- Hot-path optimistic-rollback baselines are scalar / single-row / single-chat
  snapshots (the `c9e728b1` pattern), with the full-characters clone reserved for
  genuine restructures (create/delete/reorder/fork).
- Reactive watchers (chat-metadata, script-definition, lorebook) stop
  materializing full-characters / full-modules clones on every fire; the rollback
  baseline is captured lazily and scoped only when a real change is detected.
- The cheap one-line wins land (reroll slice/clone reorder, redundant transcript
  clones removed, `runTrigger` early-return-before-clone).
- The prompt-template editor stops cloning the whole DB and re-stringifying the
  whole template on every keystroke.
- Opportunistic low-priority clones are shallow-copied or scoped.
- Every narrowed hot path has a regression test asserting it never deep-clones
  the whole characters array or the whole `Database`.

## Boundary Sources

- [`../frontend-performance-audit.md`](../frontend-performance-audit.md) seeded
  the finding inventory, per-finding cost analysis, hot-path frequency, severity,
  recommended fix, and the clone-site inventory; [`status.md`](status.md) records
  which items have since closed.
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

The hot-path clone cost has two anti-patterns and one amplifier (the audit's
shared root-cause note):

- **`cloneJsonValue` = `JSON.parse(JSON.stringify(...))`** is redefined per file
  (`chatCommands.ts`, `characterCommands.ts`, `lorebookBridge.svelte.ts`,
  `scriptDefinitionBridge.svelte.ts`, `CharConfig.svelte`, …). Each
  `current*StateSnapshot()` built on it deep-clones a whole collection
  (characters / modules / lorebook), with all hydrated `message[]` histories, as
  an optimistic-rollback baseline consumed only on rare server-command failure —
  captured-and-discarded on the happy path.
- **`safeStructuredClone` of full transcripts / full characters** on reroll,
  swipe, and `runTrigger` paths clones O(chat) or O(corpus) to keep 1-2 tail
  messages or to guard a no-trigger early return.
- **`withTrustedServerProjectionWrite`'s full-`Database` `structuredClone` +
  `$state.snapshot`** (`projectionWriteGuard.svelte.ts:115/119`) is the
  amplifier: two whole-`Database` deep clones on top of every guarded write,
  including the per-token streaming write. Enabled by default in fastify/web mode
  (`bootstrap.ts` `setServerProjectionWriteGuardEnabled(true)`); called from ~100
  sites. Fixing it benefits the streaming, non-stream, SSE-apply, chat-open, and
  prompt-template paths at once.

Empirical baseline (from the audit, reproduced on a 61 MB hydrated DB): one
guarded write ≈ 255 ms (entry clone ~125 ms + refreeze clone ~130 ms); a
few-MB DB is still tens of ms per call. `currentChatStateSnapshot()` /
`currentCharacterStateSnapshot()` scale with total hydrated history across all
opened characters, not the single row mutated.

The reference fix `c9e728b1` already narrowed the **character-select** path to a
scalar `CharacterSelectionSnapshot`; this plan narrows the surviving twins on the
message, send, streaming, trigger, reroll, watcher, and editor paths, and removes
the guard amplifier underneath all of them.

## Prerequisites

Phase 0 lands the shared prerequisites before any hot-path call site is narrowed:

1. Snapshot kit: scalar / single-row / single-chat snapshot+restore pairs in
   `chatCommands.ts` / `characterCommands.ts` / `lorebookBridge.svelte.ts`,
   mirroring `CharacterSelectionSnapshot` / `restoreCharacterSelection`
   (`currentChatScopedSnapshot`/`restoreChatScopedState`,
   `ChatScriptstateSnapshot`/`restoreChatScriptstate`,
   `CharacterRowSnapshot`/`restoreCharacterRow`,
   `currentGlobalLorebookStateSnapshot`/`restoreGlobalLorebookState`, plus reuse
   of the existing `scopedLorebookStateSnapshot`).
2. Clone-cost regression harness: a reusable test helper that asserts a snapshot
   omits `characters`/`message`/full-array payload and that a hot path does not
   invoke the whole-DB / whole-characters clone primitive, generalizing the
   `c9e728b1` "captures only scalar selection state" assertion.
3. Rollback-correctness rule: a narrowed rollback must restore exactly what the
   command mutates and must not clobber unrelated concurrent edits the
   full-array restore would have wiped (the reference fix's second test).
4. Reserve-the-full-clone rule: the full-collection snapshot stays only for
   genuine restructures (create/delete/reorder/fork); narrowing a hot path never
   deletes the heavy snapshot, only stops the hot path from reaching it.

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

| Phase | Goal |
| --- | --- |
| [0. Baseline Foundations](phases/phase-0-baseline-foundations.md) | Add the scalar/single-row/single-chat snapshot kit and the clone-cost regression harness. |
| [1. Projection Write Guard](phases/phase-1-projection-write-guard.md) | Stop the guard deep-cloning the whole `Database` per guarded write (the amplifier). |
| [2. Snapshot-Family Hot-Path Narrowing](phases/phase-2-snapshot-family-narrowing.md) | Route the Critical/High `current*StateSnapshot` call sites through the narrow kit. |
| [3. Cheap High-Confidence Wins](phases/phase-3-cheap-wins.md) | Reorder/remove redundant reroll clones and the `runTrigger` clone-before-early-return. |
| [4. Script-Definition Watcher](phases/phase-4-script-definition-watcher.md) | Stop the watcher deep-reading characters/modules per fire; scope the rollback at dispatch. |
| [5. Prompt-Template Editor Keystroke Costs](phases/phase-5-prompt-template-keystroke.md) | Debounce the projection write, mutate only the edited item, replace double-stringify change detection. |
| [6. Lorebook Watcher Scope](phases/phase-6-lorebook-watcher-scope.md) | Scope the lorebook collector to the mounting panel's collection. |
| [7. Opportunistic Cleanups](phases/phase-7-opportunistic-cleanups.md) | Shallow-spread the CBS/observer/image-emotion clones and the small algorithmic costs. |
| [8. Verification Budgets](phases/phase-8-verification-budgets.md) | Keep a clone-cost regression gate on every narrowed hot path; make the harness self-checking. |

## Execution Cursor

Nothing is implemented yet. The audit (the seed inventory) is complete; this plan
is the remediation split. Start at Phase 0 (the snapshot kit + the clone-cost
harness), then Phase 1 (the guard — the single highest-leverage fix), then Phase
2 (apply the narrow snapshots to the Critical/High sites). Phases 3-7 are
independent cleanups that can land in any order once their prerequisite phase
(0 for the snapshot-dependent ones) exists. Phase 8 is the standing
verification-gate layer.

For every narrowed path: capture a scalar/single-row/single-chat rollback,
restore only what the command mutates (Prerequisite 3), keep the full clone for
genuine restructures (Prerequisite 4), and add a regression test asserting the
hot path never clones every character (the reference fix's
`not.toHaveProperty('characters')` assertion is the template).

## Not In This Plan

- Replacing the optimistic-write / command / event / revision model or the
  projection/bootstrap/hydration model with a new sync model.
- Re-architecting how hydrated `message[]` histories accumulate into
  `DBState.db.characters`; the plan reduces what is cloned, not where state
  lives.
- The candidates the audit investigated and rejected or downgraded — they are
  recorded under "Investigated but not flagged" in
  [`active-risk-analysis.md`](active-risk-analysis.md) so future readers do not
  re-open them:
  - `buildMemoryWindow.ts:139` full-characters clone — the heavy branch is the
    local assembler, dead on the default `server` send route (latent foot-gun,
    not a live freeze).
  - `request.ts:247` full-prompt double clone — skipped on the default server
    route; the hot callers carry small bounded prompts.
  - `lorebook.svelte.ts:166` combined-lorebook clone — local-assembler only; a
    by-reference fix would be a correctness regression.
  - `chatTemplate.ts:40` instruct-template prompt clone — context-bounded text,
    single-digit ms, opt-in provider.
  - `ChatBody.svelte:79` `isEqual` over the simpleCharacter arrays — shared
    references hit the `===` fast path; benchmarked at 0.20 ms.
  - `PersonaSettings.svelte:68` personas double clone — bounded config; sub-ms,
    a cheap cleanup carried as a Phase 7 optional, not a freeze.
  - `protocolDiagnostics.ts:159` `structuredClone` — small bounded counters
    object.
- Changing message-store, `hypaV3Data`, or alternate split-store semantics.
