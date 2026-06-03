# Active Risk Analysis

Date: 2026-06-03

This file routes each finding area: the logical mutation, the current clone cost,
and the target clone range. It is not a verification log. Keep proof runs in
[`latest-verification.md`](latest-verification.md), and keep per-finding detail in
[`../frontend-performance-audit.md`](../frontend-performance-audit.md).

## Summary

All findings are analyzed; nothing is implemented. Severity comes from the seed
audit: 4 critical, 13 high, 6 medium, 6 low, plus the clone-site inventory. The
ordering principle is the reference fix `c9e728b1`: never deep-clone the whole
characters array, the whole `Database`, or a full message history on a
scalar-only or hot path; reserve the full clone for genuine restructures.

| Area | Current finding (actual clone range) | Target clone range | Phase / slice | Status |
| --- | --- | --- | --- | --- |
| Projection write guard (amplifier) | `withTrustedServerProjectionWrite` deep-clones the whole `Database` twice per guarded write (`structuredClone` entry + `$state.snapshot` refreeze), no field narrowing; ~255 ms on a 61 MB DB, ~100 call sites incl. per-token streaming. | O(1) copy-on-write: unwrap the proxy to its source on entry, re-wrap the same source in a fresh read-only proxy on refreeze; no value clone. | [Phase 1](phases/phase-1-projection-write-guard.md) | Planned |
| Streaming / non-stream / SSE / chat-open writes | Each guarded write under streaming (`streamResponse.ts:129`, per token), completion (`nonStreamResponse.ts:116`, 4-6 clone pairs), SSE apply (`database.svelte.ts:803`), and chat-open hydration (`database.svelte.ts:886`) pays the full-DB clone. | Closed by the guard fix; optional secondary: one trusted-write scope across the streaming tail / per message-append. | [Phase 1](phases/phase-1-projection-write-guard.md) | Planned |
| `currentChatStateSnapshot` family (message paths) | Whole-characters clone (all hydrated `message[]`) on every send, per-message edit/delete/bookmark/partial-edit, swipe/reroll, slash-var, and a per-render chat-metadata watcher; consumed only on rare rollback. | Single-chat snapshot (`currentChatScopedSnapshot`) restoring only the active chat's `message[]`; full clone kept for create/delete/reorder/fork. | [Phase 0](phases/phase-0-baseline-foundations.md) (kit) + [Phase 2](phases/phase-2-snapshot-family-narrowing.md) (apply) | Planned |
| Chat-metadata watcher (`chatBridge.svelte.ts:68/190`) | A tracked `$effect` calls `currentChatStateSnapshot()` (full-array) before its early-return guard, plus `scalarChatMetadata` clones each full chat (incl. `message[]`) before stripping to ~13 scalar keys; re-fires per chunk while streaming. | Lazy per-row rollback captured only when a real metadata change is detected; `scalarChatMetadata` picks `CHAT_PATCH_ALLOWED_KEYS` directly without serializing `message`. | [Phase 2](phases/phase-2-snapshot-family-narrowing.md) | Planned |
| `currentCharacterStateSnapshot` (character paths) | Whole-characters + `characterOrder` clone on character field edits (`setCurrentCharacter`/`setCharacterByIndex`) and lorebook-mutating triggers (`v2Set*`). | `CharacterRowSnapshot`/`restoreCharacterRow` cloning only the one character row + scalars; full clone kept for create/delete/reorder. | [Phase 0](phases/phase-0-baseline-foundations.md) (kit) + [Phase 2](phases/phase-2-snapshot-family-narrowing.md) | Planned |
| `currentLorebookStateSnapshot` (global-lorebook + trigger) | Whole characters + modules clone on global-lorebook select/create/delete (`lorepreset.svelte:28`) and the 6 lorebook trigger effects (`lorebookBridge.svelte.ts:94`), neither of which touch characters/modules broadly. | `currentGlobalLorebookStateSnapshot` (`loreBook`+`loreBookPage` only) for select/create/delete; reuse `scopedLorebookStateSnapshot('character:'+chaId, prevGlobalLore)` for the trigger sites; drop the redundant `setCurrentCharacter` re-clone. | [Phase 0](phases/phase-0-baseline-foundations.md) (kit) + [Phase 2](phases/phase-2-snapshot-family-narrowing.md) | Planned |
| Scriptstate var writes (`triggers.ts:1344`, `chatVar.svelte.ts:36`, `command.ts`, `triggers.ts:3081`) | Whole-characters clone to roll back a single `scriptstate` key (`setVar`/`setChatVar`/`/setvar`/`/addvar`) or a single `chat.note` (`v2SetAuthorNote`); `setVar` fires multiple times per trigger pass. | `ChatScriptstateSnapshot`/`restoreChatScriptstate` (shallow-clone only the active chat's `scriptstate`, + the note scalar for author-note); hoist one snapshot per `runTrigger` pass. | [Phase 2](phases/phase-2-snapshot-family-narrowing.md) | Planned |
| Reroll / swipe (`rerollNavigation.svelte.ts:60/95/105/147`) | `recordGeneratedReroll` clones the full transcript then `.slice` to keep 1-2 tail messages; the `apply*` helpers clone the full characters array for rollback; `:105` clones `record.message` the dispatch re-clones. | Tail-only clone (`safeStructuredClone(message.slice(previousLength))`); chat-scoped rollback in the `apply*` helpers; pass `record.message` by reference. | [Phase 3](phases/phase-3-cheap-wins.md) (reorder/redundant) + [Phase 2](phases/phase-2-snapshot-family-narrowing.md) (rollback) | Planned |
| `runTrigger` clone-before-early-return (`triggers.ts:1198`) | `safeStructuredClone(char)` + `safeStructuredClone(chat)` (overlapping, full character incl. all chats/messages) run before the `triggers.length === 0` early return; multiplicative for recursive effects. | Hoist the early return above the clones; clone only the active chat once + a shallow `{ ...char, triggerscript: [...] }`; thread the cloned char/chat through recursion. | [Phase 3](phases/phase-3-cheap-wins.md) | Planned |
| Script-definition watcher (`scriptDefinitionBridge.svelte.ts:228/300`) | `currentScriptDefinitionStateSnapshot()` clones full characters + modules per fire (before the early-return guard); re-fires per token while a config/module panel is open. | Drop the full-state snapshot from the effect; keep only the small per-key stringify for change detection; build the rollback lazily/scoped in `dispatchWatchedReplacement`. | [Phase 4](phases/phase-4-script-definition-watcher.md) | Planned |
| Prompt-template editor keystroke (`PromptSettings.svelte:196/358`) | Whole `promptTemplate` clone into `DBState.db` per keystroke (+ the guard clones the whole DB twice) + a double `JSON.stringify` (server + draft) per keystroke for change detection. | Debounce the optimistic write into the existing 250 ms timer; mutate only the edited item; replace the double stringify with a server-revision discriminator. (Guard half closes with Phase 1.) | [Phase 5](phases/phase-5-prompt-template-keystroke.md) | Planned |
| Lorebook watcher (`lorebookBridge.svelte.ts:427`) | `JSON.stringify` of every character's `globalLore` + every chat's `localLore` across all characters + module lorebooks, rebuilt in full per fire (no message read → bounded to lore bytes). | Scope the snapshot/diff to the mounting panel's collection (selected character's `globalLore` + open chat's `localLore`, or the open module). | [Phase 6](phases/phase-6-lorebook-watcher-scope.md) | Planned |
| Opportunistic low items | CBS `{{history}}` clone+parse+stringify per message; Claude observer full body clone; character image/emotion full-character + full-array clones; per-token regex recompile; `{{#each}}` re-injection; per-render `console.log`; `SideChatList` O(folders×chats) scan. | Shallow-spread / scalar-baseline / memoize / scope as the audit's per-finding fixes describe. | [Phase 7](phases/phase-7-opportunistic-cleanups.md) | Planned |

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

Land Phase 0 (kit + harness) and Phase 1 (guard) first — they unblock and amplify
everything else — then narrow the Critical/High snapshot call sites in Phase 2,
then the independent cleanups (Phases 3-7), with Phase 8 as the standing gate.

- The guard fix is highest leverage; the snapshot kit is the shared dependency.
- Every narrowing keeps the full-collection snapshot for genuine restructures and
  proves the hot path no longer reaches it (clone-cost regression test).
- A narrowed rollback restores exactly what the command mutates; correctness is
  proven by a failed-command rollback test (the reference fix's second test).

## Investigated But Not Flagged

Carried from the audit so future readers do not re-open them:

- `buildMemoryWindow.ts:139` — full-characters clone on the local-assembler path,
  dead on the default `server` send route. Latent foot-gun, not a live freeze.
  **Downgraded to low (inventory only).**
- `request.ts:247` — full-prompt double clone, skipped on the default server
  route; hot callers carry small bounded prompts. **Downgraded to low.**
- `lorebook.svelte.ts:166` — combined-lorebook clone, local-assembler only; a
  by-reference fix would be a correctness regression (child mode mutates in
  place). **Downgraded to low.**
- `chatTemplate.ts:40` — instruct-template prompt clone, context-bounded text,
  single-digit ms, opt-in provider. **Benign.**
- `ChatBody.svelte:79` — `isEqual` over the simpleCharacter arrays hits the
  reference `===` fast path (shared references); benchmarked 0.20 ms. **Benign.**
- `PersonaSettings.svelte:68` — personas double clone is bounded config, sub-ms;
  a cheap cleanup carried as a Phase 7 optional, not a freeze. **Downgraded to
  low.**
- `protocolDiagnostics.ts:159` — small bounded counters object. **Benign.**

## Non-Goals

- Do not re-architect where hydrated `message[]` histories live; reduce what is
  cloned, not the storage model.
- Do not change message-store, `hypaV3Data`, or alternate semantics.
- Do not narrow a rollback's restore set or the guard's immutability contract.
- Do not treat a downgraded/benign candidate above as open work.
