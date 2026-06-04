# Active Risk Analysis

Date: 2026-06-04

This file routes each finding area to its target clone range and phase. It is
not a verification log. Keep proof runs in
[`latest-verification.md`](latest-verification.md). Keep per-finding detail in
[`../frontend-performance-audit.md`](../frontend-performance-audit.md).

## Summary

All findings are analyzed. Phase 0, the primary Phase 1 guard fix, all six
Phase 2 slices, and Phase 3 (cheap wins) are implemented; Phases 4-7 remain
planned and Phase 8 is the standing gate. Severity comes from the seed audit: 4
critical, 13 high, 6 medium, 6 low, plus the clone-site inventory.

Principle: do not clone the whole characters array, whole `Database`, or full
message history for scalar-only hot paths. Keep full clones for real
restructures.

## Risk Map

- Projection write guard: implemented in Phase 1. Guarded writes now unwrap to a
  writable pass-through proxy and refreeze with a fresh read-only proxy tree, so
  the former two whole-`Database` clones per guarded write are gone. The rare
  full-projection replacement path may still snapshot once.
- Streaming, completion, SSE, and chat-open writes: the per-write full-DB clone
  cost is closed by the Phase 1 guard fix. The optional batching slice is
  deferred; reopen only if proxy wrap transitions show up in profiling.
- `currentChatStateSnapshot` message paths: send, message edit, swipe/reroll,
  slash var, and chat-metadata watcher cloned all characters. DONE (Phase 2):
  `currentChatScopedSnapshot`, with full clone kept for create/delete/reorder/fork.
  Phase: [Phase 0](phases/phase-0-baseline-foundations.md) kit +
  [Phase 2](phases/phase-2-snapshot-family-narrowing.md).
- Chat-metadata watcher (`chatBridge.svelte.ts` watcher +
  `scalarChatMetadata`): the effect snapshotted all chats before its early
  return, and `scalarChatMetadata` cloned each full chat.
  DONE (Phase 2): rollback captured lazily per changed row, only allowed scalar
  keys copied. Phase: [Phase 2](phases/phase-2-snapshot-family-narrowing.md).
- Character paths: `currentCharacterStateSnapshot` cloned all characters for
  field edits and `v2Set*` triggers. DONE (Phase 2) for
  `setCurrentCharacter`/`setCharacterByIndex` + the `v2Set*` trigger callers via
  `CharacterRowSnapshot` / `restoreCharacterRow`; image/emotion handlers remain
  (Phase 7). Phase: [Phase 0](phases/phase-0-baseline-foundations.md) kit +
  [Phase 2](phases/phase-2-snapshot-family-narrowing.md).
- Global-lorebook and trigger paths: `currentLorebookStateSnapshot` cloned
  characters and modules for global-lorebook edits and lorebook triggers. DONE
  (Phase 2) for select/create/delete (`loreBook`/`loreBookPage` snapshot) and the
  6 trigger sites (scoped single-character `globalLore` rollback); the LoreBook
  sidebar/MCP callers remain. Phase:
  [Phase 0](phases/phase-0-baseline-foundations.md) kit +
  [Phase 2](phases/phase-2-snapshot-family-narrowing.md).
- Scriptstate var writes: `setVar`, `setChatVar`, `/setvar`, `/addvar`, and
  `v2SetAuthorNote` cloned all characters to roll back one chat field. DONE
  (Phase 2): `ChatScriptstateSnapshot`, plus one snapshot per `runTrigger` pass.
  Follow-up `48d473dc` fixed the separate direct-write bug where `runTrigger`
  `setVar`/`v2SetVar` synced scriptstate into the read-only projection without the
  guard. Phase: [Phase 2](phases/phase-2-snapshot-family-narrowing.md) +
  [Phase 3 follow-up](phases/phase-3-cheap-wins.md).
- Reroll and swipe: reroll clones the full transcript before slicing, and the
  `apply*` helpers cloned all characters for rollback. The rollback baseline is
  DONE (Phase 2): chat-scoped rollback. The full-transcript clone-before-slice and
  the redundant `safeStructuredClone(record.message)` are DONE (Phase 3):
  `recordGeneratedReroll` clones the tail only, the dispatch takes rows by
  reference (ids minted inside the write guard), and the regenerate path truncates
  the live transcript in place instead of cloning + reinstalling it. Phase:
  [Phase 3](phases/phase-3-cheap-wins.md).
- `runTrigger`: cloned the full character and chat before the no-trigger early
  return. DONE (Phase 3): the early return runs before any clone; the
  trigger-bearing path clones only the active chat, and the whole-character clone
  is lazy (`materializeChar`) — paid once, only when a data effect installs the
  character (a pure shallow character would have poisoned the read-only projection
  on install). Phase: [Phase 3](phases/phase-3-cheap-wins.md).
- Script-definition watcher: clones full characters and modules per effect fire
  while the config/module panel is open. Target: keep per-key string snapshots;
  build rollback lazily in `dispatchWatchedReplacement`. Phase:
  [Phase 4](phases/phase-4-script-definition-watcher.md).
- Prompt-template editor: Phase 1 removed the guard clone, but each keystroke
  still clones the whole prompt template and double-stringifies for change
  detection. Target: debounce the projection write, mutate one item, and use a
  revision discriminator. Phase:
  [Phase 5](phases/phase-5-prompt-template-keystroke.md).
- Lorebook watcher: rebuilds a DB-wide lore stringify map per fire. Target:
  scope the collector to the mounted panel's collection. Phase:
  [Phase 6](phases/phase-6-lorebook-watcher-scope.md).
- Opportunistic low items: CBS history, Claude observer, image/emotion, regex,
  `{{#each}}`, `console.log`, and `SideChatList` scan. Target: shallow-spread,
  scope, memoize, or remove as listed in the slice. Phase:
  [Phase 7](phases/phase-7-opportunistic-cleanups.md).

## Source Anchors

- Guard and snapshots: `src/ts/server/projectionWriteGuard.svelte.ts`,
  `src/ts/chatCommands.ts`, `src/ts/characterCommands.ts`,
  `src/ts/server/lorebookBridge.svelte.ts`,
  `src/ts/server/scriptDefinitionBridge.svelte.ts`,
  `src/ts/server/chatBridge.svelte.ts`.
- Write paths: `src/ts/process/postGeneration/streamResponse.ts`,
  `nonStreamResponse.ts`, `src/ts/process/rerollNavigation.svelte.ts`,
  `src/ts/process/triggers.ts`, `src/ts/parser/chatVar.svelte.ts`,
  `src/ts/process/command.ts`, `src/ts/storage/database.svelte.ts`.
- Call sites: `src/lib/ChatScreens/DefaultChatScreen.svelte`,
  `src/lib/ChatScreens/Chat.svelte`, `src/lib/Setting/Pages/PromptSettings.svelte`,
  `src/lib/Setting/lorepreset.svelte`.
- Reference fix and proof template: `c9e728b1`,
  `src/ts/compatibilityAdapters.test.ts`.

## Decision

Phase 0 (kit + harness), the Phase 1 primary guard fix, Phase 2 (all six
Critical/High snapshot call-site slices), and Phase 3 (cheap wins) are done.
Phases 4-7 are independent cleanups. Phase 8 is the standing gate.

- The highest-leverage guard fix and the Critical/High snapshot narrowing have
  landed; the Phase 0 snapshot kit was the shared dependency for that work and is
  reused by the remaining Phase 7 image/emotion narrowing.
- Every narrowing keeps the full-collection snapshot for genuine restructures and
  proves the hot path no longer reaches it (clone-cost regression test).
- A narrowed rollback restores exactly what the command mutates; correctness is
  proven by a failed-command rollback test (the reference fix's second test).

## Investigated But Not Flagged

Carried from the audit so future readers do not re-open them:

- `buildMemoryWindow.ts` - full-characters clone on the local-assembler path,
  dead on the default `server` send route. Latent foot-gun, not a live freeze.
  Downgraded to low (inventory only).
- `request.ts` - full-prompt double clone, skipped on the default server
  route; hot callers carry small bounded prompts. Downgraded to low.
- `lorebook.svelte.ts` - combined-lorebook clone, local-assembler only; a
  by-reference fix would be a correctness regression (child mode mutates in
  place). Downgraded to low.
- `chatTemplate.ts` - instruct-template prompt clone, context-bounded text,
  single-digit ms, opt-in provider. Benign.
- `ChatBody.svelte` - `isEqual` over the simpleCharacter arrays hits the
  reference `===` fast path (shared references); benchmarked 0.20 ms. Benign.
- `PersonaSettings.svelte` - personas double clone is bounded config, sub-ms;
  a cheap cleanup carried as a Phase 7 optional, not a freeze. Downgraded to
  low.
- `protocolDiagnostics.ts` - small bounded counters object. Benign.

## Non-Goals

- Do not re-architect where hydrated `message[]` histories live; reduce what is
  cloned, not the storage model.
- Do not change message-store, `hypaV3Data`, or alternate semantics.
- Do not narrow a rollback's restore set or the guard's immutability contract.
- Do not treat a downgraded/benign candidate above as open work.
