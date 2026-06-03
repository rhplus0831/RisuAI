# Frontend Performance Audit — Deep-Clone & Hot-Path Costs

**Audit date:** 2026-06-03

This audit was seeded by commit `c9e728b1` ("perf: stop deep-cloning the whole characters array on sidebar character clicks"). That fix found that `changeChar()`/`dispatchSelectCharacter()` captured an optimistic-rollback baseline via `currentCharacterStateSnapshot()`, which `JSON.parse(JSON.stringify(...))`-deep-cloned the **entire** `DBState.db.characters` array — including every hydrated chat's full `message[]` history (many megabytes once chats are opened) — synchronously on the UI thread on every sidebar click, freezing the UI 1–3s before the select + hydration requests could even fire. The fix narrowed selection (which mutates only 3 scalars) to a scalar-only `CharacterSelectionSnapshot`, while keeping the heavy full-array snapshot only for create/delete/reorder, which genuinely restructure the array. This audit hunts for issues of the same spirit: broad/deep clones or full-state serializations of large data (the characters array, hydrated message histories, the whole `Database`) on hot paths (sidebar click, chat open, per-keystroke, per-message render, per-token streaming, the send loop, prompt assembly, trigger/script runs, CBS template eval), plus reactive recompute and algorithmic costs that scale with messages/characters.

## Executive summary

The reference fix removed one instance of a pervasive anti-pattern; this audit finds the pattern is systemic. The single most important discovery is that **the trusted-projection write guard (`projectionWriteGuard.svelte.ts`) deep-clones the entire `Database` twice on every guarded write** — once via `structuredClone(source)` on entry and once via `$state.snapshot(value)` on refreeze — with zero field narrowing. Because nearly every optimistic write (including the **per-chunk streaming write** at `streamResponse.ts:129`) funnels through this guard, the same multi-MB clone the reference fix eliminated is paid continuously during generation, per token. This guard is the amplifier behind several other findings: fixing it benefits ~100 call sites at once.

The second systemic root cause is **`currentChatStateSnapshot()`** (and its siblings `currentCharacterStateSnapshot()`, `currentLorebookStateSnapshot()`, `currentScriptDefinitionStateSnapshot()`), which JSON-round-trip the whole `characters` array as an optimistic-rollback baseline on send, per-message edits, swipes, trigger variable writes, and a reactive chat-metadata watcher that re-fires per render. In every case the snapshot is consumed only by a rollback that runs on rare server-command failure, so the heavy clone is captured-and-discarded on the happy path. The fix mirrors `c9e728b1`: scalar/single-row/single-chat rollback baselines, reserving the full-array clone for genuine array restructures (create/delete/reorder/fork).

A handful of bounded-config and cold-path candidates were investigated and rejected (prompt-assembly local fallback, persona/template editing, lodash `isEqual` over shared array references) — see "Investigated but not flagged."

**Counts by severity:** Critical: 4 · High: 13 · Medium: 6 · Low: 6 · (plus an exhaustive inventory below).

## Findings

### [CRITICAL] Trusted projection write guard deep-clones the WHOLE Database twice on every guarded write

**Location:** `src/ts/server/projectionWriteGuard.svelte.ts:115` (and the structuredClone branch at `:119`)

```ts
function snapshotServerProjectionValue(value: Database): Database {
  if (value && typeof value === 'object') {
    const source = readOnlyServerProjectionSources.get(value)
    if (source) {
      return structuredClone(source) as Database
    }
  }
  return $state.snapshot(value) as Database
}
```

**What happens:** `withTrustedServerProjectionWrite` runs at depth-1 entry `DBState.db = snapshotServerProjectionValue(DBState.db)` (line 43) and on refreeze `DBState.db = createReadOnlyServerProjection(snapshotServerProjectionValue(DBState.db))` (line 35). On entry `DBState.db` is the read-only proxy, so `readOnlyServerProjectionSources.get` hits and returns `structuredClone(source)` — a full deep clone of the entire `Database`. On refreeze `DBState.db` is the plain cloned object (WeakMap miss), so it falls through to `$state.snapshot(value)`, itself a second full deep clone. So **each guarded write performs two full-`Database` deep clones**, with no field narrowing — including `characters[].chats[].message[]` hydrated histories.

**Why it is expensive / how large:** `DBState.db` is the full `Database`. Per the state model, once chats are opened the hydrated `message[]` histories accumulate into `DBState.db.characters`, making the DB multi-megabyte. Reproduced empirically on a 61 MB DB: entry clone ~125 ms + refreeze clone ~130 ms = ~255 ms per guarded write; a few-MB DB is still tens of ms per call.

**When it runs (hot path):** The guard is enabled by default in fastify/web mode (`bootstrap.ts:163` `setServerProjectionWriteGuardEnabled(true)`). `withTrustedServerProjectionWrite`/`withServerProjectionApply` are called from ~100 sites including the hottest paths: the streaming loop (`streamResponse.ts:129`, per chunk), `changeChar` (`characters.ts:985`, every sidebar click — the exact reference-fix data), per-message edits, triggers, CBS setvar, chat-open hydration, and SSE apply. This is the same synchronous-deep-clone-on-hot-path freeze class as `c9e728b1`, but worse: it runs at per-chunk frequency during streaming and clones twice.

**Recommended fix:** Stop deep-cloning the whole DB on the trusted-write path. The read-only proxy already enforces immutability recursively, so no defensive value copy is needed. Keep one persistent mutable working copy (the source the proxy wraps); on depth-1 entry, unwrap `DBState.db` to that source via `readOnlyServerProjectionSources.get(proxy)` and assign the bare source (no clone); on refreeze, re-wrap the same source in a freshly-minted read-only proxy. Both transitions are O(1). Two caveats: (1) `createReadOnlyServerProjectionProxy` memoizes per-target, so evict the source from `readOnlyServerProjectionTargets` before re-wrapping (or use raw assignment) so Svelte sees a new identity and fires reactivity; (2) confirm nothing reads `DBState.db` reactively mid-write expecting a `$state` proxy. As a cheaper interim mitigation, at minimum eliminate the SECOND clone: on refreeze wrap the already-cloned plain object as-is instead of re-running `$state.snapshot` — that alone halves the cost. **This is the highest-leverage fix; it simultaneously resolves the streaming, non-stream, SSE-apply, and chat-open findings below.**

---

### [CRITICAL] Per-token streaming write clones the whole DB twice on every chunk

**Location:** `src/ts/process/postGeneration/streamResponse.ts:129`

```ts
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = nextData
          DBState.db.characters[selectedChar].reloadKeys += 1
        })
```

**What happens:** Each guarded call snapshots the entire `DBState.db` twice (via the guard above), only to write a single message's `.data` string and bump `reloadKeys`.

**Why it is expensive / how large:** Two full-`Database` `structuredClone`/`$state.snapshot` passes per chunk, over all characters, all chats, all hydrated message histories — multi-MB once chats are opened.

**When it runs (hot path):** `consumeStreamResponse` (`orchestrateResponse.ts:98`) is awaited and NOT wrapped in an outer trusted write, so each inner call runs at guard depth 0 (depth resets between chunks). The `while (streamAborted === false)` loop (line 93) reads a stream chunk and runs this guarded write on every chunk carrying text (line 104 `if (readed.value)`); the provider stream enqueues a chunk per token/group with no batching, so this is effectively per-token. It also fires on both the local and `serverOwnsPostGeneration` paths. This is strictly worse than the `c9e728b1` select freeze: continuous jank for the whole generation, scaling with total opened-chat history size.

**Recommended fix:** **Primary:** the guard fix above (eliminate the full-DB clone). **Secondary (independently worthwhile):** hold a single trusted-write scope open for the streaming tail rather than re-entering the guard per chunk — wrap the whole `while`-loop region in one `withTrustedServerProjectionWrite` so depth stays ≥1 across chunks and the enter/refreeze snapshot happens at most once, or add a dedicated narrow mutator that updates `message[msgIndex].data` + `reloadKeys` on the live reactive object without re-snapshotting. The tail message is appended once (line 68); subsequent chunks only touch `.data` and `reloadKeys`.

---

### [CRITICAL] `currentChatStateSnapshot()` deep-clones the entire characters array on every chat/message edit and send

**Location:** `src/ts/chatCommands.ts:73`

```ts
export function currentChatStateSnapshot(): ChatStateSnapshot {
  return {
    characters: cloneJsonValue(DBState.db.characters ?? []),
    selectedCharID: get(selectedCharID),
  }
}
// cloneJsonValue = JSON.parse(JSON.stringify(value)) (line 68-71)
```

**What happens:** Returns a JSON-round-trip clone of the ENTIRE `DBState.db.characters` array, including every character's `chats[].message[]` hydrated history, as an optimistic-rollback baseline.

**Why it is expensive / how large:** Per the state model, hydrated message histories accumulate into `DBState.db.characters`, so the cloned array is multi-megabyte. This is the same data shape and same clone primitive as the reference fix — the surviving twin on the message paths. The `characters` field is read ONLY inside `restoreChatState` (`chatCommands.ts:80-86`), which runs only on a 409/error (the cold path). So on the success path the eager full-array clone is built synchronously and then discarded unused.

**When it runs (hot path):** Invoked as `const previous = currentChatStateSnapshot()` at ~57 non-test sites that are the hottest message paths: `DefaultChatScreen` submit (`:215`, every send), every per-message handler in `Chat.svelte` (edit `:258`, delete `:169`, partial-edit save `:284`, bookmark `:471`, alt-greeting/fork `:1194/1279/1319/1656`), `command.ts` `mutateCurrentChatMessages` (`:336`, plus `/setvar`/`/addvar` at `:200/219`), and the three reroll/swipe helpers in `rerollNavigation.svelte.ts` (`:83/96/111`). Every edit, delete, bookmark, swipe, reroll, slash-var, and send synchronously builds the clone before the request fires.

**Recommended fix:** Replace the full-array clone with a narrow, target-row snapshot mirroring `c9e728b1` (`CharacterSelectionSnapshot`/`restoreCharacterSelection`). The rollback only needs to restore the one chat being mutated. Capture `{ selectedCharID, charIndex, chatPage, chat: cloneJsonValue(activeChat) }` — cloning only the active chat row (its `message[]`, `scriptstate`, metadata), not the whole array — and change `restoreChatState` to write back only that row inside `withTrustedServerProjectionWrite`. This preserves rollback correctness for the delete/replace/truncate/scriptstate/compatible-metadata paths (all of which touch only the active chat) while cloning a single chat. Keep the full-array snapshot only for genuine multi-row restructures (create/delete/reorder/fork). Note: `prepareCompatibleChatUpdate` diffs `previousChat` vs `nextChat` using a separate `snapshotChat` (one chat) — that per-chat clone is bounded and acceptable; only the full-array clone is the problem.

---

### [CRITICAL] Whole-characters-array deep clone runs on every reactive chat-state change inside the chat-metadata watcher `$effect`

**Location:** `src/ts/server/chatBridge.svelte.ts:68`

```ts
    $effect(() => {
      const projectionApplyEpoch = getServerProjectionApplyEpoch()
      const character = DBState.db.characters?.[get(selectedCharID)]
      const currentState = currentChatStateSnapshot()
      const currentChats = new Map(
        (character?.chats ?? [])
          .filter((chat) => typeof chat.id === 'string' && chat.id)
          .map((chat) => [chat.id as string, scalarChatMetadata(chat as unknown as ChatSnapshot)]),
      )
```

**What happens:** A tracked `$effect` calls `currentChatStateSnapshot()` (the full-array clone above) on every fire, keeping it as `previousState` to use as the rollback baseline for tiny per-chat metadata patches.

**Why it is expensive / how large:** `currentChatStateSnapshot()` deep-clones the entire characters array including every hydrated chat's full `message[]` history (many MB; `streamResponse.ts:130` writes streamed text directly into this subtree). The early-return guard at lines 80–91 only short-circuits the diff/dispatch — the expensive clone at line 68 runs BEFORE the guard, unconditionally, on every re-trigger. The apply-epoch (the early-return key) is bumped only by `withServerProjectionApply`, NOT by the `withTrustedServerProjectionWrite` used for streaming, so the diff branch is also entered.

**When it runs (hot path):** The watcher is mounted by `SideChatList.svelte:75` (the DEFAULT sidebar content during normal chatting, `Sidebar.svelte:1008`), plus `ChatList.svelte:34` and `CharConfig.svelte:156`. The effect reads `DBState.db.characters[selectedCharID]` and iterates `character.chats`, subscribing to that subtree. Every `withTrustedServerProjectionWrite` reassigns `DBState.db` (dirtying the signal the effect reads); streaming wraps EACH chunk in `withTrustedServerProjectionWrite`, so the effect re-runs per chunk (many/sec during a response), plus on every message edit. This is the same defect class and same data as `c9e728b1`, on a hotter trigger. (Note: the guard itself already full-clones the DB per write per the critical guard finding — this effect adds a SECOND full-characters clone on top, per chunk.)

**Recommended fix:** Stop materializing a full-array `ChatStateSnapshot` inside the tracked effect. The watcher only ever dispatches per-chat/per-folder metadata patches via `dispatchUpdateChat`/`dispatchUpdateChatFolder`, whose rollback needs only that one row's scalar metadata. Replace the `previousState`/`currentState` full-array snapshot (chatBridge lines 61, 68, 89, 113) with a scalar/single-row rollback baseline captured lazily ONLY when `changedFields()` detects an actual change (inside `queueChatPatch`/`queueFolderPatch`, materializing just the affected chat/folder row), so nothing is cloned on the common no-change re-trigger. A minimal "gate `currentChatStateSnapshot` behind `Object.keys(patch).length>0`" is NOT sufficient, because `previousState` is reassigned every run as the diff baseline — the baseline itself must be made cheap (per-row), not merely deferred. The metadata-diff maps (`scalarChatMetadata`/`sanitizeChatPatch`) are scalar-only and fine to keep (but see the High finding on `scalarChatMetadata`).

---

### [HIGH] `currentCharacterStateSnapshot()` JSON-deep-clones the entire characters array on every snapshot

**Location:** `src/ts/characterCommands.ts:57`

```ts
export function currentCharacterStateSnapshot(): CharacterStateSnapshot {
  return {
    characters: cloneJsonValue(DBState.db.characters ?? []),
    characterOrder: cloneJsonValue(DBState.db.characterOrder ?? []),
    currentChar: (DBState.db as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}
```

**What happens:** Full JSON round-trip of `DBState.db.characters` (and `characterOrder`) as a character-edit rollback baseline.

**Why it is expensive / how large:** `DBState.db.characters` accumulates every hydrated chat's full `Message[]` history — the exact heavy structure the reference fix removed. The snapshot is consumed by `dispatchCompatibleCharacterUpdate` → `restoreCharacterState`, which re-clones and reassigns the whole array.

**When it runs (hot path):** Used as the rollback `previous` in `setCurrentCharacter` (`database.svelte.ts:968`) and `setCharacterByIndex` (`:995`), both guarded by `canUseServerCommands()` (hardcoded `true`), so the clone always fires. `setCurrentCharacter` is invoked from trigger effects `v2SetCharacterDesc` (`triggers.ts:2409`), `v2SetReplaceGlobalNote` (`:2445`), `v2SetLorebook`/`v2SetLorebookActivation` (`:2212/2262`), and `:2932/2989/3012/3043`. Those run inside `runTrigger`, which fires per-send (`buildHistoryWindow.ts:129` 'start', `outputTrigger.ts:29` 'output', `request.ts:278` 'request'). So a character whose trigger script uses these `v2Set*` effects pays one-or-more full-array clones per send (each inside `withTrustedServerProjectionWrite`, whose guard also clones). High not critical: the per-send trigger path is conditional on the character having `v2Set*` effects, and it does not run per-render/token.

**Recommended fix:** Scope the rollback to the single character row, mirroring `c9e728b1`. A character-FIELD update only needs the prior state of that one character: add a `CharacterRowSnapshot { index, characterId, character: cloneJsonValue(thatOneRow) }` plus a `restoreCharacterRow()` that restores just `DBState.db.characters[index]` (and `selectedCharID`/`currentChar` scalars) under `withTrustedServerProjectionWrite`, and route `setCurrentCharacter`/`setCharacterByIndex`/`dispatchCompatibleCharacterUpdate` through it. Keep the full-array snapshot ONLY for `dispatchCreateCharacter`/`dispatchDeleteCharacter`/`dispatchReorderCharacters`. Lower-frequency callers (`setCharacterSupaMemory`, `characterCards.ts:136/369/648/1752`, plugins/MCP) share the same fix.

---

### [HIGH] `sendMain()` deep-clones the entire characters array (all hydrated histories) on every send/continue

**Location:** `src/lib/ChatScreens/DefaultChatScreen.svelte:215`

```ts
const previous = currentChatStateSnapshot()
const currentChatRecord =
  DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage]
let cha: Message[] = cloneJsonValue(currentChatRecord.message ?? [])
```

**What happens:** At the top of `sendMain()`, before any await, `currentChatStateSnapshot()` clones the entire characters array; line 218 additionally clones the current chat's whole message array, and line 275 clones it again.

**Why it is expensive / how large:** The full-array clone scales with total hydrated history across all open characters, not with the single appended message. `previous` flows only to `dispatchReplaceMessages` → `restoreChatState` (which itself re-clones), and rollback fires only on rare server-command failure — pure waste on the success path of every send.

**When it runs (hot path):** `send()`/`sendContinue()` → `sendMain()` runs on every message send and Continue press; the same full-array clone recurs at line 783 (the add-empty-char-message button). Runs synchronously on the UI thread before the request is dispatched — the SEND-path analog of the SELECT-path freeze the reference commit fixed. High (per-send), not critical (not per-render/token/keystroke).

**Recommended fix:** Replace the full-array `currentChatStateSnapshot()` on these message-replace rollback paths with a chat-scoped snapshot capturing only the affected chat's pre-mutation message array (plus `chatId`/`charId`). Add `currentChatMessagesSnapshot()`/`restoreChatMessages()` to `chatCommands.ts` and a sibling dispatcher that builds its rollback from the scoped snapshot, making both snapshot and failure-path restore O(current chat). Do NOT change the shared `currentChatStateSnapshot`/`restoreChatState` globally — narrow only the message-replace paths. Secondary: collapse the double current-chat clone — line 218 already clones into `cha`; line 275 can assign by reference (`liveChat.message = cha`) rather than re-cloning.

---

### [HIGH] `currentChatStateSnapshot()` full-characters deep clone on every per-message edit/delete/bookmark/partial-edit

**Location:** `src/lib/ChatScreens/Chat.svelte:258`

```ts
async function edit() {
  const previous = currentChatStateSnapshot()
  const chat =
    DBState.db.characters[selIdState.selId].chats[
      DBState.db.characters[selIdState.selId].chatPage
    ]
  const messageId = chat.message[idx]?.chatId
  ...
  dispatchUpdateMessage(messageId, { data: message }, previous)
```

**What happens:** Every per-message user action captures a full-array `currentChatStateSnapshot()` up front, fed only to the rollback closure (`restoreChatState`) of a single-message command.

**Why it is expensive / how large:** Multi-MB JSON round-trip of all characters/chats/histories, used only on rare failure, even though the command mutates a single message.

**When it runs (hot path):** `edit()` (`:258`), `rm()` (`:169`, delete/truncate), `handlePartialEditSave()` (`:284`), `toggleBookmark()` (`:471`), and the alt-greeting/fork handlers (`:1194/1279/1319/1656`). All are per-message user actions in the visible message list — frequent, synchronous, on the UI thread. High (frequent but not every-frame).

**Recommended fix:** Introduce a chat-scoped (not scalar — a message edit must restore the affected chat's message list) rollback snapshot in `chatCommands.ts`: a `ChatScopedSnapshot { characterIndex/chaId, chatPage/chatId, messages: cloneJsonValue(targetChat.message) }` plus `currentChatScopedSnapshot()`/`restoreChatScopedState()` that clone/restore only the single target chat. Route the per-message dispatch helpers (`dispatchUpdateMessage`, `dispatchDeleteMessage`, `dispatchTruncateMessages`, `dispatchReplaceMessages`, `dispatchAppendMessage`) and their `Chat.svelte` call sites through it. Keep the full snapshot for genuinely-structural multi-resource paths (create/delete/reorder chat, restructuring fork). Add a regression test asserting the message-edit path captures only the target chat.

---

### [HIGH] `cloneMessagesWithIds()` / `currentChatStateSnapshot()` clones on every per-message edit action

**Location:** `src/lib/ChatScreens/Chat.svelte:144`

```ts
function cloneMessagesWithIds(chat: Chat): Message[] {
    const messages = cloneJsonValue(chat.message ?? [])
    for (const item of messages) {
      item.chatId ||= uuidv4()
    }
    return messages
  }
```

**What happens:** `cloneMessagesWithIds` deep-clones the active chat's whole `message[]` to backfill `chatId`s. In 10 of its 11 call sites (`180,207,225,242,268,295,1290,1330,1667`) this runs only in the `else` fallback reached when a message lacks a `chatId` (largely dead once messages carry ids); `toggleBookmark` (`:479`) clones unconditionally. **The dominant, unconditional cost is the co-located `currentChatStateSnapshot()`** at the top of every one of these handlers (lines `169,258,284,471,1194,1279,1319,1656`), which full-corpus clones `DBState.db.characters` on every edit/delete/disable/bookmark/fork/swipe.

**Why it is expensive / how large:** `currentChatStateSnapshot()` is the multi-MB whole-characters JSON clone the reference fix targeted; `cloneMessagesWithIds` clones one chat's history (still MB-sized on a long chat). Both compound on a long chat.

**When it runs (hot path):** Per-message-click handlers in the `{#each}`-rendered message component. The `currentChatStateSnapshot()` clone fires unconditionally on every such click; `cloneMessagesWithIds` fires on bookmark toggle and the missing-chatId fallback.

**Recommended fix:** **Primary:** narrow the rollback snapshot via the chat-scoped `currentChatStateSnapshot` fix above. **Secondary:** make `cloneMessagesWithIds` fallback-only and lazy — in `toggleBookmark` (`:479`) assign a `chatId` to only the single target message and dispatch via `messageId` (no whole-history clone); for the other 10 fallback sites, ensure a `chatId` on the single needed message and dispatch the targeted command (delete/update/truncate by id) rather than cloning the whole `chat.message`. Fix the unconditional snapshot first.

---

### [HIGH] `scalarChatMetadata` deep-clones each full chat (including its entire `message[]`) before stripping to scalar fields, on every watcher fire

**Location:** `src/ts/server/chatBridge.svelte.ts:190`

```ts
function scalarChatMetadata(chat: ChatSnapshot): ChatSnapshot {
  return sanitizeChatPatch(cloneJsonValue(chat))
}
```

**What happens:** `cloneJsonValue(chat)` clones the ENTIRE chat — including `chat.message: Message[]` and `chat.localLore` — and only afterward does `sanitizeChatPatch` keep the ~13 scalar keys in `CHAT_PATCH_ALLOWED_KEYS` (name/note/sdData/fmIndex/folderId/...). The expensive message array is cloned and immediately discarded.

**Why it is expensive / how large:** Called in the `.map` over `character.chats` (chatBridge `:72`) for EVERY chat of the selected character, on every watcher fire. For a character with N chats this clones N full message histories per re-fire — on top of the full-characters clone in the watcher (the Critical finding above). Cost = O(total messages of the selected character) per fire.

**When it runs (hot path):** Same watcher as the chat-metadata Critical finding — mounted by `SideChatList` (default chat sidebar), `ChatList`, `CharConfig`. Re-fires on per-message mutations of the selected character (sends, streaming, edits). High not critical: per-send/per-message-mutation, and the downstream dispatch is 300ms-debounced; it does not run per-token render or per-keystroke.

**Recommended fix:** Build the scalar snapshot without ever serializing `chat.message`. Replace `sanitizeChatPatch(cloneJsonValue(chat))` with a direct pick over `CHAT_PATCH_ALLOWED_KEYS`:

```ts
function scalarChatMetadata(chat) {
  const out = {}
  for (const key of CHAT_PATCH_ALLOWED_KEYS) {
    const v = chat[key]
    if (v !== undefined) out[key] = cloneJsonValue(v)
  }
  return out
}
```

This avoids serializing `chat.message[]` and `chat.localLore[]` entirely while still cloning the small allowed values (`bookmarks`/`bookmarkNames`/`modules` are small bounded arrays). Track the co-located `currentChatStateSnapshot()` full-characters clone at line 68 under the watcher Critical finding.

---

### [HIGH] Script-definition watcher deep-clones the entire characters array + modules (with all message histories) on every reactive change

**Location:** `src/ts/server/scriptDefinitionBridge.svelte.ts:228`

```ts
$effect(() => {
  const projectionApplyEpoch = getServerProjectionApplyEpoch()
  ensureAllClientScriptDefinitionIds()
  const currentState = currentScriptDefinitionStateSnapshot()   // full characters + modules clone
  const currentSnapshots = collectScriptDefinitionCollectionSnapshots()
```

**What happens:** `currentScriptDefinitionStateSnapshot()` (`:41-47`) does `cloneJsonValue(DBState.db.characters ?? [])` AND `cloneJsonValue(DBState.db.modules ?? [])` on every effect fire, stored in `previousState`, BEFORE the early-return guards.

**Why it is expensive / how large:** The characters clone includes every chat's full `message[]` history (multi-MB once hydrated); modules can carry large lorebook/regex/trigger blobs. The projection-epoch early-return does NOT short-circuit streaming fires (streaming uses `withTrustedServerProjectionWrite`, which does not bump the apply epoch), and the clone runs before that guard anyway.

**When it runs (hot path):** Mounted by `CharConfig.svelte:157` (character config panel) and `ModuleMenu.svelte:42` (module editor). While either is open: (1) each debounced script/trigger edit writes drafts into `character.customscript`/`triggerscript`, re-firing the effect → full characters+modules clone; (2) because the effect deeply reads `DBState.db.characters`, streaming token writes re-invalidate it → another full clone per token while the panel is open. High not critical: panel-gated rather than always-on.

**Recommended fix:** Stop reading characters/modules deeply on every fire. Keep only `collectScriptDefinitionCollectionSnapshots()` (small, per-key script/trigger JSON strings) for change-detection; drop `currentScriptDefinitionStateSnapshot()`/`previousState` from the effect. Build the rollback baseline lazily and scoped inside `dispatchWatchedReplacement` (`:257-298`), which already knows the changed `characterId`/`moduleId`: snapshot only `{ characterId, scripts: clone(character.customscript), triggers: clone(character.triggerscript) }` (or the module equivalent) at dispatch time, restoring only that one row's scripts/triggers. This makes the cost O(one character's scripts), independent of how many chats are hydrated or streaming.

---

### [HIGH] `currentLorebookStateSnapshot` clones the entire characters (and modules) array on global-lorebook select/create/delete

**Location:** `src/lib/Setting/lorepreset.svelte:28`

```ts
function selectLorebook(index) {
    const lorebookId = DBState.db.loreBook?.[index]?.id
    if (canUseServerCommands() && lorebookId) {
      dispatchSelectGlobalLorebook(lorebookId, currentLorebookStateSnapshot())
      return
    }
    DBState.db.loreBookPage = index
  }
```

**What happens:** `currentLorebookStateSnapshot()` (`lorebookBridge.svelte.ts:94`) clones `DBState.db.characters` (line 99) and `DBState.db.modules` (line 100) in full, as the rollback for selecting/creating/deleting a global lorebook — operations that do not even touch characters/modules.

**Why it is expensive / how large:** `DBState.db.characters` carries all hydrated message histories (the multi-MB blob from the reference fix) plus modules' lorebook/regex/trigger blobs. The select command only POSTs `{ baseRevision }`; rollback for select/create/delete needs only `loreBook` + `loreBookPage`.

**When it runs (hot path):** `selectLorebook()` is wired to the `onclick` of every entry in the global LoreBook modal (`:60-66`); `canUseServerCommands()` is unconditionally true, so the server branch (full clone) is live and the cheap `DBState.db.loreBookPage = index` branch is dead in web mode. The delete (`:91`) and create (`:119`) handlers are rarer; the per-click select is hot. High (megabyte-scale clone synchronously on a click path, inside an occasionally-opened modal).

**Recommended fix:** Add a lorebook-only snapshot variant (e.g. `currentGlobalLorebookStateSnapshot`) returning `{ loreBook: cloneJsonValue(DBState.db.loreBook ?? []), loreBookPage, selectedCharID }` with characters/modules omitted, plus a matching `restoreGlobalLorebookState` that restores only `loreBook` + `loreBookPage`. Use it in `selectLorebook` (`:31`), the delete handler (`:91`), and the create handler (`:119`). Keep the full-array snapshot only for ops that actually rewrite characters/modules.

---

### [HIGH] `currentLorebookStateSnapshot` deep-clones full characters + modules on every lorebook-mutating trigger run

**Location:** `src/ts/server/lorebookBridge.svelte.ts:94`

```ts
export function currentLorebookStateSnapshot(): LorebookStateSnapshot {
  ensureAllClientLorebookIds()
  return {
    loreBook: cloneJsonValue((DBState.db.loreBook ?? []) as GlobalLorebook[]),
    loreBookPage: DBState.db.loreBookPage ?? 0,
    characters: cloneJsonValue(DBState.db.characters ?? []),
    modules: cloneJsonValue((DBState.db.modules ?? []) as RisuModule[]),
    selectedCharID: get(selectedCharID),
  }
}
```

> Note: this finding shares the snapshot function with the `lorepreset.svelte` High finding above, but on a different (per-send trigger) trigger path. The inventory records it at **medium** for the trigger-path frequency; it is grouped here under the same root cause.

**What happens:** Called from `triggers.ts:2211, 2261, 2931, 2988, 3011, 3042` inside the v2 lorebook trigger effects (modify / activate / create / modify-by-index / delete / always-active). Each clones the entire characters array (with messages) + modules just to hold a rollback snapshot, even though the subsequent `dispatchReplaceCharacterLorebooks` only replaces one character's `globalLore`. `ensureAllClientLorebookIds()` additionally walks every character, chat, and module on each call. **Compounding:** immediately after each snapshot, `setCurrentCharacter(char)` is called, which itself runs `currentCharacterStateSnapshot()` — a SECOND full-array clone per effect.

**Why it is expensive / how large:** Two full-array deep clones (characters + modules, then characters again via `setCurrentCharacter`) synchronously per lorebook-mutating effect on the send path. Multi-MB.

**When it runs (hot path):** `runTrigger` per-send ('start' prompt assembly, 'output' post-gen). A character whose start/output `triggerscript` contains a lorebook-mutating effect hits this every send; `v2Loop`/`v2LoopNTimes` can fire it multiple times per send. Display/request modes are filtered out, so it is per-send, not per-render. Medium-to-high: gated to characters using lorebook-mutating start/output triggers.

**Recommended fix:** Replace `currentLorebookStateSnapshot()` at the 6 trigger call sites with a scoped, single-character rollback equivalent to the existing `scopedLorebookStateSnapshot('character:'+char.chaId, <prev globalLore>)` (capture `globalLore` BEFORE the in-place edit), which `restoreScopedLorebookState` already handles without touching characters/modules/messages. Export a small `characterLorebookRollbackSnapshot(chaId, previousGlobalLore)` helper. Drop the redundant `setCurrentCharacter(char)` (or use a no-snapshot variant), since the per-character `globalLore` replacement is already dispatched. Gate `ensureAllClientLorebookIds()` behind an init flag instead of running the full-tree walk per trigger call.

---

### [HIGH] Non-streaming response writes clone the whole DB twice per message append

**Location:** `src/ts/process/postGeneration/nonStreamResponse.ts:116`

```ts
      withTrustedServerProjectionWrite(() => {
        messagesAt().push({
          role: msg[0],
          data: result,
          saying: currentChar.chaId,
          ...
        })
      })
```

**What happens:** Each guarded write snapshots the whole `DBState.db` twice (via the guard). The function makes 2–3 separate, non-nested guarded calls per appended message (lines `98, 111, 116, 130, 138`), so a single non-stream completion pays ~4–6 full-DB clone pairs.

**Why it is expensive / how large:** Multi-MB full-DB clone per guarded block; non-nested calls each pay their own entry+exit snapshot pair.

**When it runs (hot path):** `orchestrateResponse.ts:157` → `applyNonStreamResponse` on the non-streaming completion branch, once per generated candidate/reroll. Per-send; the minority branch (most providers stream), so frequent-but-not-every-completion → high.

**Recommended fix:** **Primary:** the guard fix (eliminate the full-DB clone) — fixes this and the worse streaming case. **Secondary (file-local):** batch the 2–3 separate `withTrustedServerProjectionWrite` calls into a single guarded scope per message-append. The awaited `inlayResult.promise` blocks may force a separate scope; resolve inlay text before opening the guarded scope or accept one extra. Batching alone only reduces 4–6 clones to ~2 — fix 1 is load-bearing.

---

### [HIGH] Chat-open hydration clones the whole DB twice to fill one chat's messages

**Location:** `src/ts/storage/database.svelte.ts:886`

```ts
export function hydrateServerChatMessages(
  chatId: string,
  message: unknown[],
  hypaV3Data?: unknown,
): boolean {
  return withTrustedServerProjectionWrite(() => {
    for (const character of DBState.db.characters ?? []) {
      const chat = character.chats?.find((candidate) => candidate.id === chatId)
      ...
```

**What happens:** A surgical single-chat mutation (`chat.message = message`) wrapped in `withTrustedServerProjectionWrite`, paying two whole-DB clones to splice one chat's messages. `hydrateServerCharacterLorebook` (`:915`) is the same pattern per character open.

**Why it is expensive / how large:** At chat-open the chat being opened is a message-free stub, but every OTHER already-opened chat has its hydrated history accumulated into `DBState.db.characters`; `structuredClone`/`$state.snapshot` traverse all of it twice. This is the compounding-on-chat-open scenario `c9e728b1` addressed for `changeChar`.

**When it runs (hot path):** The `$effect` in `startChatMessageHydration` (`chatMessageHydration.svelte.ts:385`) fires on every character/chat switch → `hydrateActiveChat` → `hydrateChat` (`:84`) → `hydrateServerChatMessages`; also via `hydrateChatsBulk` (`:127`) and `applyServerChatMessagesProjection` (`:160`). `hydrateChat` returns early when `hydratedChatIds.has(chatId)`, so the clone fires on the FIRST hydration of each distinct chat per session, not every re-open — still hot (chat switching) and compounding → high.

**Recommended fix:** Fix the guard's snapshot strategy (the Critical guard finding), not the hydration call site. The two full-DB clones per trusted write are the cost; mutate the underlying source directly and re-point the proxy without re-snapshotting, or at minimum drop the refreeze-time `$state.snapshot`. This is a shared fix that speeds every command/chat/character write, not only chat-open.

---

### [HIGH] `recordGeneratedReroll` deep-clones the entire transcript just to keep the last 1–2 messages

**Location:** `src/ts/process/rerollNavigation.svelte.ts:60`

```ts
export function recordGeneratedReroll(previousLength: number): void {
  const message = activeChatRecord().message
  if (previousLength < message.length) {
    rerolls.push(safeStructuredClone(message).slice(previousLength))
    rerollid = rerolls.length - 1
  }
}
```

**What happens:** `safeStructuredClone(message)` deep-clones the FULL active transcript, then `.slice(previousLength)` discards all but the newly-generated tail (typically 1–2 messages).

**Why it is expensive / how large:** `message` is the full hydrated transcript (thousands of entries / many MB on a long chat). Each `Message` carries `data` plus optional `generationInfo`/`promptInfo` (a full prompt array). Cloning all of it to keep the last 1–2 messages is waste proportional to chat length — the clone-then-discard antipattern of the reference fix.

**When it runs (hot path):** `sendChatCompletion.ts:25` → `recordGeneratedReroll(options.previousLength)`, once at the end of every completed send / continue / regenerate. Per-send → high.

**Recommended fix:** Swap the slice/clone order so only the tail is deep-cloned: `rerolls.push(safeStructuredClone(message.slice(previousLength)))`. `message.slice(previousLength)` builds a short array sharing the tail element references (cheap), then `safeStructuredClone` deep-clones just those 1–2 messages. Byte-identical result, O(tail) instead of O(full transcript). One-line reorder, fully behavior-preserving.

---

### [HIGH] reroll/unReroll/applyTailSlice deep-clone the full transcript and full characters array per swipe

**Location:** `src/ts/process/rerollNavigation.svelte.ts:95` (also `:83`, `:111`, `:147`)

```ts
function applyTailSlice(slice: Message[]): void {
  const previous = currentChatStateSnapshot()
  withTrustedServerProjectionWrite(() => { ... })
  const record = activeChatRecord()
  if (record.id) {
    dispatchReplaceMessages(record.id, safeStructuredClone(record.message), previous)
  }
}
```

**What happens:** Per swipe, `applyTailDataSwap` (`:83`), `applyTailSlice` (`:96`), and `applyTranscript` (`:111`) each call `currentChatStateSnapshot()` (full characters-array clone) for rollback. `applyTailSlice` additionally `safeStructuredClone(record.message)` for the dispatch payload — but `dispatchReplaceMessages` already re-clones each message via `messages.map(toMessageSnapshot)`, so this clone is **redundant**. `reroll()` also clones the full transcript at `:147` and the buffered candidate tail at `:139/187` (bounded, benign).

**Why it is expensive / how large:** The dominant cost is the full-characters `currentChatStateSnapshot()` (multi-MB, all hydrated histories). The active transcript clones (`:105`, `:147`) are also large on a long chat.

**When it runs (hot path):** `reroll()`/`unReroll()` are wired to the per-message swipe arrows (`DefaultChatScreen.svelte:949-950`), the side-menu reroll button (`:1202`), and gesture bindings (`:701/830`). The common navigation swipe (cycling buffered candidates) routes through `applyTailSlice` and runs fully synchronously with no await — blocking the swipe gesture on the UI thread, repeatable in quick succession. Per-click → high.

**Recommended fix:** (1) Replace `currentChatStateSnapshot()` in the three `apply*` helpers with a chat-scoped rollback capturing only the active chat's prior `message[]` (plus indices), mirroring `CharacterSelectionSnapshot`, with a matching `restoreActiveChatMessages` restoring just that chat inside `withTrustedServerProjectionWrite`. (2) Drop the redundant `safeStructuredClone(record.message)` at `:105` — pass `record.message` by reference (the dispatch deep-clones internally). (3) For `reroll()`'s `:147`, operate on a small tail copy (only the trailing assistant group is popped) rather than cloning the entire transcript. The candidate-tail clones at `:139/187` are bounded and fine.

---

### [HIGH] Per-keystroke full deep-clone of the entire `promptTemplate` on every prompt-item edit

**Location:** `src/lib/Setting/Pages/PromptSettings.svelte:196`

```ts
function queuePromptItemUpdate(promptItem: PromptItem, previousItem: PromptItem): void {
    const itemId = promptItemId(promptItem)
    const index = promptTemplateDraft.value.findIndex((item) => item.id === itemId)
    if (index !== -1) {
      withTrustedServerProjectionWrite(() => {
        DBState.db.promptTemplate = cloneJsonValue(promptTemplateDraft.value)
      })
    }
```

**What happens:** On every keystroke in any prompt-item textarea, the ENTIRE active `promptTemplate` array is JSON-round-trip cloned into `DBState.db.promptTemplate`, AND the wrapping `withTrustedServerProjectionWrite` clones the whole `DBState.db` twice (the guard).

**Why it is expensive / how large:** `promptTemplate` is tens-to-low-hundreds of KB (dozens of items, each plain/jailbreak text commonly multi-KB). On top of that, the guard `structuredClone`s the entire multi-MB `DBState.db` (including hydrated histories) twice per keystroke. This is the reference-fix pathology at full-DB scale, on a per-keystroke path.

**When it runs (hot path):** `PromptDataItem.svelte` `$effect` (`:49`) fires per keystroke (TextAreaInput `oninput` → `$bindable` → effect → `onUpdate` → `queuePromptItemUpdate`, wired at `:520`). High not critical: confined to the Prompt Settings page while editing a preset, but every keystroke there clones the whole DB twice plus the template once.

**Recommended fix:** In order of impact: (1) **Debounce the projection write** — the server command (`:213`) is already 250ms-debounced, but the optimistic projection write (`:200-202`) fires every keystroke; coalesce it into the same debounced timer so the heavy guarded write runs at most once per idle window. (2) Inside the guarded write, mutate only the edited item: `DBState.db.promptTemplate[index] = cloneJsonValue(promptItem)` (index already computed) instead of replacing the whole array. (3) The full-DB `structuredClone` inside the guard is a repo-wide amplifier — the broader guard fix applies here too.

## Findings — Medium

### [MEDIUM] `v2SetAuthorNote` trigger effect deep-clones the whole characters array per author-note update

**Location:** `src/ts/process/triggers.ts:3081`

```ts
          if (!arg.displayMode) {
            const chatStateSnapshot = currentChatStateSnapshot()
            let chatId: string | undefined
            withTrustedServerProjectionWrite(() => {
              const currentCharacter = getCurrentCharacter()
              const chatSlot = currentCharacter.chats?.[currentCharacter.chatPage]
              if (chatSlot) {
                chatSlot.note = value
                chatId = chatSlot.id
              }
            })
            if (chatId) {
              dispatchUpdateChat(chatId, { note: value }, chatStateSnapshot)
            }
          }
```

**What happens:** Full characters-array clone to roll back a single `chat.note` string change; `dispatchUpdateChat` already sends a minimal `{ note }` patch.

**Why it is expensive / how large:** Multi-MB clone (all hydrated histories) on the per-send trigger path. Medium: gated to characters whose trigger contains a `v2SetAuthorNote` effect (uncommon), and it is one instance of the broader `currentChatStateSnapshot` pattern (the far more frequent twin is `setVar`, below).

**When it runs (hot path):** Inside `runTrigger`, per-send ('start'/'output'/'request'), when an author-note-setting trigger fires.

**Recommended fix:** Capture only the chat id, `selectedCharID`, prior note value, and `chatPage` (a `ChatNote`/scalar rollback analogous to `CharacterSelectionSnapshot`) and pass that to `dispatchUpdateChat`. Do NOT fix this in isolation — provide a shared scalar chat-row rollback snapshot for hot scalar-only chat-row writes (note + scriptstate) and reserve the full-array clone for true restructures.

---

### [MEDIUM] Trigger `setVar` closure deep-clones the whole characters array on every variable write

**Location:** `src/ts/process/triggers.ts:1344`

> Inventory severity: **high** (per-send, multi-invocation). Grouped here under the same `currentChatStateSnapshot` root cause; the verified per-send blast radius is real but the per-rendered-message claim was refuted.

```ts
    const previous = currentChatStateSnapshot()
    varChanged = true
    chat.scriptstate ??= {}
    const stateKey = '$' + key
    chat.scriptstate[stateKey] = value
    ...
    if (chat.id) {
      dispatchPatchChatScriptstate(chat.id, { [stateKey]: value }, [], previous)
    }
```

**What happens:** Full characters-array clone to roll back a single `scriptstate` key on one chat.

**Why it is expensive / how large:** Multi-MB clone; `setVar` can be called many times per trigger pass (one per non-local `v2SetVar`/array/dict/regex effect).

**When it runs (hot path):** `setVar` short-circuits before the clone for `displayMode` and local vars, so the per-rendered-message ('display') and 'request' paths do NOT reach it. It fires on the 'start' and 'output' trigger passes per send (each possibly multiple times). High (per-send with per-pass amplification), not the finder's critical.

**Recommended fix:** Replace the whole-array snapshot with a `ChatScriptstateSnapshot { chatId, selectedCharID, scriptstate }` (shallow-clone only the current chat's scriptstate map) plus a `restoreChatScriptstate(snapshot)` that writes back just that chat's scriptstate (located by id). Hoist a single snapshot to the start of the `runTrigger` pass and reuse it across all `setVar` calls. Apply the same scriptstate-only snapshot to `setChatVar` (`chatVar.svelte.ts:36`) and `command.ts:213/234`.

---

### [MEDIUM] `setChatVar` deep-clones the whole characters array on every `{{setvar}}`/`{{addvar}}` CBS evaluation

**Location:** `src/ts/parser/chatVar.svelte.ts:36`

> Inventory severity: **high**. Grouped under `currentChatStateSnapshot`; the per-render claim was refuted, real frequency is per-send with per-message amplification.

```ts
export function setChatVar(key: string, value: string): void {
  const selectedChar = get(selectedCharID)
  const chat =
    DBState.db.characters[selectedChar]?.chats?.[DBState.db.characters[selectedChar].chatPage]
  if (!chat) return
  const previous = currentChatStateSnapshot()
  chat.scriptstate ??= {}
  chat.scriptstate['$' + key] = value
  dispatchCurrentChatScriptstatePatch({ ['$' + key]: value }, [], previous)
}
```

**What happens:** Full characters-array clone on every chat-variable write, to keep a rollback baseline for a single-key scriptstate patch.

**Why it is expensive / how large:** Multi-MB JSON round-trip. `setChatVar` fires only when `matcherArg.runVar === true` — which in non-test code is only `runSendChatMessageVariables` (`sendChatPromptAssembly.ts:54-60`), the per-send `.map` over `chat.message` (at prompt assembly and again post-generation), so ~2× per send with N clones in a tight synchronous loop (one per message containing a `{{setvar}}`). Also the default var-setter for the scripting/trigger backend.

**When it runs (hot path):** Per-send with per-message amplification (NOT per-render — ordinary rendering passes `runVar:false` and short-circuits).

**Recommended fix:** Replace with a single-chat, scriptstate-scoped rollback (chat id, `selectedCharID`, shallow clone of just that chat's `scriptstate`) plus `restoreChatScriptstate`. Restore only that chat's scriptstate by id on failure. Shared with the `setVar` and `command.ts:213/234` fix.

---

### [MEDIUM] `runTrigger()` deep-clones the whole character (all chats+messages) and the whole chat before the no-trigger early return

**Location:** `src/ts/process/triggers.ts:1198`

```ts
char = arg.displayMode ? char : safeStructuredClone(char)
...
let chat = arg.displayMode ? arg.chat : safeStructuredClone(arg.chat ?? char.chats[char.chatPage])
...
if (!triggers || triggers.length === 0) {
  ...
  return null
}
```

**What happens:** `safeStructuredClone(char)` deep-clones the full character including `char.chats[].message[]`, and `safeStructuredClone(arg.chat ?? ...)` clones the full active chat (overlapping data) — BOTH before the `triggers.length === 0` early return, so even zero-trigger characters pay the double clone.

**Why it is expensive / how large:** O(total character bytes), multi-MB; double-clone of overlapping data; multiplicative for recursive `runtrigger` effects (up to 10 deep, each re-cloning the already-cloned char+chat).

**When it runs (hot path):** Non-`displayMode` calls. On the default Fastify path the 'start' (`buildHistoryWindow.ts:129`) and 'output' (`outputTrigger.ts:29`) passes are assembled SERVER-side (server prompt assembly + server-owned post-gen), so the live client paths are the local/unsupported-content fallback send, manual/slash triggers (`command.ts:254`), and the multiplicative recursive `runtrigger` (`:1535/1954`). `request.ts:278` and `scripts.ts:137` pass `displayMode:true` and correctly skip the clone. Medium (the hottest default path moved server-side).

**Recommended fix:** (1) Hoist the early return above the clones — compute `triggers` first and `return null` before any `safeStructuredClone` when empty. (2) Stop double-cloning and stop cloning the whole character: clone only the active chat once, and use a shallow copy of `char` with a shallow-copied `triggerscript` list (`{ ...char, triggerscript: char.triggerscript.map(v => ({ ...v, lowLevelAccess })) }`) instead of `safeStructuredClone(char)`, dropping the O(corpus) clone of all the OTHER chats/messages. (3) For recursive `manual` calls, pass the already-cloned char/chat through rather than re-deep-cloning each level.

---

### [MEDIUM] Lorebook watcher JSON.stringifies every character's `globalLore` and every chat's `localLore` (and module lorebooks) on each reactive change

**Location:** `src/ts/server/lorebookBridge.svelte.ts:427`

```ts
function collectLorebookCollectionSnapshots(): Map<string, string> {
  const snapshots = new Map<string, string>()
  ...
  for (const character of DBState.db.characters ?? []) {
    if (character.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
      snapshots.set(`character:${character.chaId}`, snapshotJson(character.globalLore ?? []))
    }
    for (const chat of character.chats ?? []) {
      if (chat.id) snapshots.set(`chat:${chat.id}`, snapshotJson(chat.localLore ?? []))
    }
  }
```

**What happens:** `snapshotJson` (`JSON.stringify`) over each hydrated character's `globalLore`, every chat's `localLore` across ALL characters/chats, every global lorebook, and every module's lorebook — rebuilt in full on every reactive fire (the `delayMs` debounce wraps only the eventual dispatch, not the snapshot rebuild).

**Why it is expensive / how large:** O(total lore bytes). loreBook entries carry free-text key/secondkey/comment/content. Notably it does NOT read `chat.message`, so it is bounded to lore data (kilobytes to low MB), not the multi-MB message histories — hence medium, not high.

**When it runs (hot path):** Inside the `watchServerBackedLorebooks` `$effect` (`:355`), mounted only by `lorepreset.svelte:24`, `ModuleMenu.svelte:41`, `LoreBookSetting.svelte:41` — i.e. while a lorebook/module/lore-preset panel is open. Confirmed per-keystroke: `LoreBookData.svelte`'s draft `$effect` writes `cloneJsonValue(draft)` back into the reactive lore entry on each keystroke, bumping the deep dependency this collector reads. Gated to lore-editing sessions, not the universal hot paths → medium.

**Recommended fix:** Scope the snapshot/diff to the collection being edited rather than rebuilding the whole DB-wide map per fire. Tie the watcher's tracked scope to the mounting panel: a `LoreBookSetting`/`lorepreset` session needs only global lorebooks + the selected character's `globalLore` + the open chat's `localLore`; a `ModuleMenu` session needs only the open module's lorebook. Lowest-risk minimal change: cut the unbounded all-chats-of-all-characters `localLore` loop down to only the chats of the selected character (and the open module instead of all modules).

---

### [MEDIUM] Watcher `$effect` re-stringifies the entire `promptTemplate` twice on every keystroke

**Location:** `src/lib/Setting/Pages/PromptSettings.svelte:358`

```ts
$effect(() => {
    const serverValue = DBState.db.promptTemplate ?? []
    const serverSnapshot = snapshotJson(serverValue)
    const draftSnapshot = snapshotJson(promptTemplateDraft.value)

    if (
      serverSnapshot !== previousPromptTemplateServerSnapshot &&
      serverSnapshot !== draftSnapshot
    ) {
      promptTemplateDraft.value = cloneJsonValue(serverValue)
    }
    previousPromptTemplateServerSnapshot = serverSnapshot
  })
```

**What happens:** `snapshotJson` (`JSON.stringify`) runs twice per flush — over `DBState.db.promptTemplate` and over `promptTemplateDraft.value` — purely to detect whether the server pushed an external change.

**Why it is expensive / how large:** Each pass serializes the whole template (~55 KB measured against real `data/db.json.migrated`: 30 items, ~55,152 bytes; bot presets 53/60 KB), so ~110 KB/keystroke — on top of the line-201 full clone and the per-keystroke `executeTokenize`. Real jank while typing in the template editor, but an order of magnitude smaller than the multi-MB whole-characters clone, hence medium.

**When it runs (hot path):** The effect tracks both `DBState.db.promptTemplate` (written per keystroke by `queuePromptItemUpdate`) and `promptTemplateDraft.value` (dirtied per keystroke), so it re-runs every keystroke. Mounted only in `BotSettings.svelte`/`Settings.svelte` (the prompt-template editor), not the chat composer/render/token path → medium.

**Recommended fix:** Replace the whole-array double `JSON.stringify` change-detection with a cheap discriminator. A pure reference check won't work because `queuePromptItemUpdate` reassigns `DBState.db.promptTemplate` to a fresh reference on every local keystroke. Preferred: gate the sync on the server revision (`cachedServerCommandRevision`) — only re-pull `serverValue` into the draft when the revision advanced; skip both stringify passes otherwise. Lighter alternative: have the local writers set `previousPromptTemplateServerSnapshot` to the snapshot they just wrote, and stop tracking `promptTemplateDraft.value` in this effect (it only needs to react to external server pushes).

## Findings — Low

### [LOW] `{{history}}/{{charhistory}}/{{userhistory}}` deep-clone + re-parse every message in the chat per CBS invocation

**Location:** `src/ts/cbs.ts:364` (also `:376`, `:399`, `:1687`)

> Inventory severity: **high** for the `:364` block. After cross-verification the dominant cost is the per-message parse+stringify (not the clone), the per-clone unit is one small Message, and the path is opt-in (a user-authored CBS tag, present in no built-in default template); the heaviest realistic frequency is per-send prompt assembly, not per-frame render. Reported here as a low-priority cleanup; retained at its finder severity in the inventory.

```ts
chat.message
  .filter((v) => { return v.role === 'user' })
  .map((v) => {
    v = safeStructuredClone(v)
    v.data = risuChatParser(v.data, matcherArg)
    return JSON.stringify(v)
  })
```

**What happens:** For `{{history}}`/`{{charhistory}}`/`{{userhistory}}`, each iterated `Message` is deep-cloned, its `.data` re-run through `risuChatParser`, then `JSON.stringify`'d — across the whole `chat.message` array.

**Why it is expensive / how large:** The per-clone unit is one small Message (dominated by its `data` string); the aggregate is O(history) but the dominant cost is the parse+stringify per message, not the clone. If the tag appears in display text it can become O(messages²); but no built-in default template emits these tags, so the realistic home is per-send prompt assembly when an author opts in.

**When it runs (hot path):** Conditional on a user-authored CBS tag being present; per-send prompt assembly in the common case (potentially per-rendered-message only if an author embeds `{{history}}` in display text).

**Recommended fix:** Shallow-copy the message and only reparse its text field: `return JSON.stringify({ ...v, data: risuChatParser(v.data, matcherArg) })` at `:376`, `:399`, `:1687` — a shallow spread is sufficient (only `.data` is reassigned; the live `DBState` Message must not be mutated, which the spread preserves) and drops the `structuredClone`/rfdc overhead. Skip a memo cache (over-engineering for an opt-in path). Low priority.

---

### [LOW] Character image/emotion edit paths deep-clone the whole characters array per action

**Location:** `src/ts/characters.ts:138`

```ts
  const previous = currentCharacterStateSnapshot()
  const previousCharacter = cloneCharacterSnapshot(DBState.db.characters[charIndex])
  ...
  dispatchCompatibleCharacterUpdate(previousCharacter, DBState.db.characters[charIndex], previous)
```

**What happens:** Two heavyweight clones — `currentCharacterStateSnapshot()` (full characters array) and `cloneCharacterSnapshot` (full target character with chats+messages) — on `selectCharImg` (`:138`), `dumpCharImage` (`:195`), `changeCharImage` (`:220`), `addCharEmotion` (`:242`), `rmCharEmotion` (`:259`).

**Why it is expensive / how large:** Multi-MB. `CHARACTER_PATCH_EXCLUDED_KEYS` already excludes `chats`, so cloning the target character's message histories is pure waste; `previous` is only consumed by the rare rollback path.

**When it runs (hot path):** Explicit user-action handlers in `CharConfig.svelte` (icon onclick `:713`, file picker `:739`, emotion buttons `:816/832`), invoked a handful of times during avatar/emotion setup. Occasional explicit-action path → low (large data, but not a hot path).

**Recommended fix:** Replace both heavyweight snapshots with a single-character scalar-baseline rollback keyed by `chaId` (like `restoreCharacterSelection`): capture only the fields these handlers mutate (`image`, `ccAssets`, `emotionImages`, `extentions.pngExif`) and restore just that character in place on failure; replace `cloneCharacterSnapshot(full character)` with a clone of only the non-excluded scalar fields.

---

### [LOW] Script-definition watcher JSON.stringifies every character's scripts and triggers on each reactive change

**Location:** `src/ts/server/scriptDefinitionBridge.svelte.ts:300`

```ts
function collectScriptDefinitionCollectionSnapshots(): Map<string, string> {
  const snapshots = new Map<string, string>()
  for (const character of DBState.db.characters ?? []) {
    if (character.chaId) {
      snapshots.set(`characterScripts:${character.chaId}`, snapshotJson(character.customscript ?? []))
      snapshots.set(`characterTriggers:${character.chaId}`, snapshotJson(character.triggerscript ?? []))
    }
  }
```

**What happens:** `JSON.stringify` over every character's `customscript[]`/`triggerscript[]` plus every module's regex/trigger, rebuilt in full on each fire. Does NOT read `chat.message`.

**Why it is expensive / how large:** Script/regex/trigger source aggregate is realistically tens of KB (low-hundreds for a heavy Lua user), NOT the multi-MB message scale — so `largeData` is not confirmed for this function. The genuinely heavy cost on the same effect tick is the co-located full-characters clone (the High script-definition finding).

**When it runs (hot path):** Per keystroke during a `CharConfig`/`ModuleMenu` editing session (draft commit per keystroke). Low: small-to-medium data on an editor-scoped path, dominated by the sibling clone.

**Recommended fix:** Fix together with the High script-definition finding (the dominant cost). For this function specifically: cache per-key snapshot strings and only re-stringify the key whose source actually changed, or move the snapshot computation into the existing 250ms debounce window instead of every reactive read.

---

### [LOW] `snapshotChat()` JSON-deep-clones the full chat (with history) twice per slash-command message mutation

**Location:** `src/ts/process/command.ts:326`

> Inventory severity: **medium**. Confirmed large data but the hot-path claim was downgraded: the path is per-slash-command-submit / configured-trigger-command-effect (occasional), not the per-click sidebar hot path.

```ts
function snapshotChat(chat: Chat): Chat {
  return JSON.parse(JSON.stringify(chat)) as Chat
}
```

**What happens:** `mutateCurrentChatMessages` makes THREE large synchronous clones per call: `currentChatStateSnapshot()` (full corpus, `:336`) + `snapshotChat` twice (`previousChat:338`, `nextChat:347`). `prepareCompatibleChatUpdate` then re-serializes both message arrays again to diff them (~5× per command).

**Why it is expensive / how large:** Full characters array (multi-MB) + full chat history cloned twice. Confirmed large.

**When it runs (hot path):** Reached only via `/send`/`/sendas`/`/comment`/`/cut`/`/del` (`DefaultChatScreen.svelte:222`, on explicit slash-command submit) and trigger 'command'/'v2Command' effects (`triggers.ts:1524/2039`, only when a character has a command-type trigger). Occasional → medium/low.

**Recommended fix:** Remove the redundant full-corpus `currentChatStateSnapshot()` at `:336` (use a targeted single-chat rollback). For the two `snapshotChat` calls: `previousChat` is genuinely needed for the diff, but `nextChat` does not need a separate clone (the mutated live chat is already a fresh object). Route `/send`-class commands to the existing scoped helpers (`dispatchAppendMessage`/`dispatchTruncateMessages`/`dispatchDeleteMessage`/`dispatchUpdateMessage`) to avoid the message-array stringify-diff.

---

### [LOW] `rerollNavigation` clones the full active message array per swipe/reroll/regenerate

**Location:** `src/ts/process/rerollNavigation.svelte.ts:147`

> Inventory severity: **medium**. Overlaps the two High reroll findings above (it re-enumerates the same `:60/95/105/147/244` clones); recorded distinctly to preserve the inventory mapping. The dominant cost is the `currentChatStateSnapshot()` full-characters clone in the `apply*` helpers, not the message-array clones the finder emphasized.

```ts
const cha = safeStructuredClone(activeChatRecord().message)
...
rerolls = candidates.map((candidate) => [safeStructuredClone(candidate)])  // line 244
...
rerolls.push(safeStructuredClone(message).slice(previousLength))  // line 63
...
dispatchReplaceMessages(record.id, safeStructuredClone(record.message), previous)  // line 105
```

**What happens:** Full active-transcript clones at `:147`/`:105` plus the full-characters `currentChatStateSnapshot()` via the `apply*` helpers; `:105` is redundant (the dispatch re-clones); `:244` (`seedRerollBufferFromAlternates`) is chat-open-only with bounded candidates (benign).

**Why it is expensive / how large:** Active chat history + whole characters array, multi-MB on long chats.

**When it runs (hot path):** Per swipe/reroll/regenerate click. Medium: per-click, not per-render/token, and each reroll also kicks off a network send.

**Recommended fix:** See the two High reroll findings — drop the redundant `:105` clone (pass by reference), use a shallow array copy at `:147` (only `.pop()` reshapes the array), and route the rollback through a chat-scoped snapshot rather than the full-characters `currentChatStateSnapshot()`. `:244` is benign; do not touch.

---

### [LOW] `registerClaudeObserver` clones the full request body per Claude send

**Location:** `src/ts/observer.svelte.ts:118`

```ts
lastClaudeObserverPayload = safeStructuredClone(arg.body)
```

**What happens:** Deep-clones the full Claude request payload (`arg.body.messages = finalChat`, the entire formatted prompt) then mutates only `lastClaudeObserverPayload.max_tokens = 10`.

**Why it is expensive / how large:** The payload can be large for long contexts (large data confirmed), but the path is gated behind the OFF-by-default experimental `claudeRetrivalCaching` setting (under `useExperimental`), runs at most once per Claude send, and is dwarfed by the LLM network round-trip it precedes. Low.

**When it runs (hot path):** Per Claude send, only when the experimental observer flag is enabled. Not a UI-thread freeze.

**Recommended fix:** Replace the deep clone with a shallow spread, since only a top-level scalar is overridden: `lastClaudeObserverPayload = { ...arg.body, max_tokens: 10 }` (drop the separate assignment). Behavior-equivalent, trivial, safe.

---

### Shared root-cause note

Many findings above collapse to **two anti-patterns and one amplifier**:

- **`cloneJsonValue` = `JSON.parse(JSON.stringify(...))`** is redefined per-file as a private clone helper (`chatCommands.ts:68`, `characterCommands.ts:52`, `lorebookBridge.svelte.ts:581`, `scriptDefinitionBridge.svelte.ts:363`, `CharConfig.svelte:482`, and others enumerated in the inventory). Each `current*StateSnapshot()` built on it deep-clones a whole collection (characters/modules/lorebook) as an optimistic-rollback baseline that is consumed only on rare server-command failure. The consolidating fix is a shared family of **scalar / single-row / single-chat snapshot+restore helpers** (the `CharacterSelectionSnapshot`/`restoreCharacterSelection` pattern from `c9e728b1`), used everywhere a hot path mutates a bounded slice, reserving the full-array clone for genuine restructures (create/delete/reorder/fork).
- **`withTrustedServerProjectionWrite`'s full-DB `structuredClone` + `$state.snapshot`** (`projectionWriteGuard.svelte.ts:115/119`) is the amplifier: it adds two whole-`Database` deep clones on top of every guarded write, including the per-token streaming write, SSE apply, chat-open hydration, and the per-keystroke prompt-template write. Fixing the guard (copy-on-write / proxy unwrap-rewrap) benefits every one of those simultaneously.

## Clone-site inventory

| File:line | Category | What is cloned | Frequency | Severity |
|---|---|---|---|---|
| `src/ts/server/chatBridge.svelte.ts:68` | full-state-serialize | `currentChatStateSnapshot()` deep-clones the ENTIRE characters array (all hydrated message histories) as a rollback baseline for tiny per-chat metadata patches | per-render | critical |
| `src/ts/server/projectionWriteGuard.svelte.ts:115` | full-state-serialize | The entire `DBState.db` Database (characters[] + all hydrated message[]) — no field narrowing | per-token | critical |
| `src/ts/server/projectionWriteGuard.svelte.ts:119` | deep-clone | The WHOLE Database (`source`) as a mutable working copy (`structuredClone`); benign small diagnostics object at `protocolDiagnostics.ts:159` | per-click | critical |
| `src/ts/process/postGeneration/streamResponse.ts:129` | full-state-serialize | Entire `DBState.db` cloned twice per chunk to write one message's `.data` + `reloadKeys` | per-token | critical |
| `src/ts/chatCommands.ts:73` | deep-clone | ENTIRE characters array (all `chats[].message[]` histories) via JSON round-trip | per-message | critical |
| `src/ts/process/triggers.ts:1344` | deep-clone | `currentChatStateSnapshot()` full characters array, to roll back one scriptstate key | per-send | high |
| `src/ts/parser/chatVar.svelte.ts:36` | deep-clone | `currentChatStateSnapshot()` full characters array, per `{{setvar}}`/`{{addvar}}` single-key patch | per-message | high |
| `src/ts/process/command.ts:336` | deep-clone | `currentChatStateSnapshot()` (full corpus) + `snapshotChat` of the full chat twice (before/after) | per-message | high |
| `src/ts/process/rerollNavigation.svelte.ts:83` | deep-clone | `currentChatStateSnapshot()` (full characters) per swipe in `apply*` helpers; `applyTailSlice` also clones the full active message array | per-click | high |
| `src/ts/server/chatBridge.svelte.ts:190` | deep-clone | `cloneJsonValue(chat)` clones the full chat (incl. `message[]`, `localLore`) then strips to ~13 scalar keys — message array cloned and discarded | per-message | high |
| `src/ts/server/scriptDefinitionBridge.svelte.ts:228` | deep-clone | `cloneJsonValue` of the full characters array + modules (all hydrated histories) per effect fire | per-click | high |
| `src/ts/chatCommands.ts:73` (via `characterCommands.ts:57`) | deep-clone | `DBState.db.characters` + `characterOrder` full JSON round-trip as character-edit rollback | per-message | high |
| `src/ts/characterCommands.ts:57` | deep-clone | Full characters array + characterOrder via JSON round-trip | per-message | high |
| `src/ts/process/postGeneration/nonStreamResponse.ts:116` | full-state-serialize | Whole `DBState.db` twice per guarded block (lines 98/111/116/130/138) → ~4–6 full-DB clones per completion | per-send | high |
| `src/ts/storage/database.svelte.ts:886` | full-state-serialize | Entire `DBState.db` twice to assign one chat's `message` (chat-open hydration); same for `hydrateServerCharacterLorebook:915` | per-click | high |
| `src/ts/process/rerollNavigation.svelte.ts:60` | deep-clone | Full active transcript cloned then `.slice` to keep last 1–2 messages (`recordGeneratedReroll`) | per-send | high |
| `src/ts/process/rerollNavigation.svelte.ts:95` | deep-clone | `currentChatStateSnapshot()` (full characters) + `safeStructuredClone(record.message)` (full transcript, redundant with dispatch) per swipe | per-click | high |
| `src/ts/cbs.ts:364` | deep-clone | Each Message of the current chat deep-cloned + re-parsed + stringified for `{{history}}`/`{{charhistory}}`/`{{userhistory}}` | per-message | high |
| `src/lib/ChatScreens/DefaultChatScreen.svelte:215` | deep-clone | `currentChatStateSnapshot()` full characters array + two current-chat message-array clones per send | per-send | high |
| `src/lib/ChatScreens/Chat.svelte:258` | deep-clone | `currentChatStateSnapshot()` full characters array per edit/delete/bookmark/partial-edit | per-message | high |
| `src/lib/Setting/Pages/PromptSettings.svelte:196` | deep-clone | Entire `promptTemplate` array JSON round-trip per keystroke (+ guard clones whole DB twice) | per-keystroke | high |
| `src/lib/Setting/lorepreset.svelte:28` | deep-clone | `currentLorebookStateSnapshot()` — full characters + modules arrays — on global-lorebook select/create/delete | per-click | high |
| `src/lib/ChatScreens/Chat.svelte:144` | deep-clone | `cloneMessagesWithIds` clones the full active chat `message[]` (fallback/bookmark); co-located `currentChatStateSnapshot()` clones all characters unconditionally | per-message | high |
| `src/ts/process/promptAssembly/buildMemoryWindow.ts:139` | deep-clone | `currentChatStateSnapshot()` full characters array to roll back one chat's `lastMemory` (local-assembler path, effectively dead on default fastify route) | per-send | high* |
| `src/ts/process/triggers.ts:3081` | deep-clone | `currentChatStateSnapshot()` full characters array to roll back one `chat.note` string | per-send | medium |
| `src/ts/server/lorebookBridge.svelte.ts:94` | deep-clone | Full characters + loreBook + modules arrays; `ensureAllClientLorebookIds()` walks every char/chat/module | per-message | medium |
| `src/ts/server/lorebookBridge.svelte.ts:427` | full-state-serialize | `JSON.stringify` of every character's `globalLore` + every chat's `localLore` + module lorebooks (NOT messages) | per-keystroke | medium |
| `src/ts/storage/database.svelte.ts:803` | full-state-serialize | Entire `DBState.db` twice per foreign SSE command event (merge fields/character-row/selection; hydrate) to assign a few keys | per-message | medium |
| `src/ts/process/triggers.ts:1198` | deep-clone | `safeStructuredClone(char)` (full character + chats + messages) + `safeStructuredClone(chat)` before the no-trigger early return | per-send | medium |
| `src/lib/ChatScreens/DefaultChatScreen.svelte:783` | deep-clone | `currentChatStateSnapshot()` full characters array + two current-chat history clones (empty-slot button); `updateGreetingIndex:514` clones for one `fmIndex` scalar | per-click | medium |
| `src/lib/Setting/Pages/PromptSettings.svelte:358` | full-state-serialize | `JSON.stringify` of the whole `promptTemplate` twice (server + draft) per keystroke for change detection | per-keystroke | medium |
| `src/ts/process/command.ts:326` | deep-clone | A full Chat object (incl. `message[]`) via JSON round-trip | per-click | medium |
| `src/ts/process/rerollNavigation.svelte.ts:147` | deep-clone | Full active `message` (147), `record.message` (105/147), per-candidate snapshots (63/244) | per-click | medium |
| `src/ts/server/scriptDefinitionBridge.svelte.ts:44` | deep-clone | Whole-collection snapshots (characters/modules/lorebook arrays) as optimistic-rollback baselines | per-click | medium |
| `src/ts/process/request/request.ts:247` | deep-clone | Full assembled prompt (`OpenAIChat[]`) cloned at 247 + per-fallback 254 + 493; context-bounded; main-send caller cold on default fastify route | per-send | medium* |
| `src/ts/process/lorebook.svelte.ts:166` | deep-clone | Concatenated lorebook entries (globalLore + localLore + module lore); text only, no messages; local-assembler path | per-send | medium* |
| `src/ts/process/templates/chatTemplate.ts:40` | deep-clone | Full assembled prompt array for instruct-template (jinja/chatml) formatting; context-bounded text, opt-in provider | per-send | medium* |
| `src/lib/ChatScreens/ChatBody.svelte:79` | reactive-recompute | lodash `isEqual` over the simpleCharacter's script/asset arrays (shared references → fast-path, never deep-walked in normal use) | per-render | medium* |
| `src/lib/Setting/Pages/PersonaSettings.svelte:68` | deep-clone | `cloneJsonValue(DBState.db.personas)` twice per keystroke (small bounded config) | per-keystroke | medium* |
| `src/ts/characters.ts:138` | deep-clone | `currentCharacterStateSnapshot()` full characters array + `cloneCharacterSnapshot` full target character (image/emotion edits) | per-click | low |
| `src/ts/server/scriptDefinitionBridge.svelte.ts:300` | full-state-serialize | `JSON.stringify` of every character's scripts/triggers + module regex/trigger (no messages) | per-keystroke | low |
| `src/ts/parser/risuChatParser.ts:638` | algorithmic | `{{#each}}`: per-element template ×N spliced into source `da` (O(da.length)) and re-scanned; compounding for nested each; template-bounded, opt-in | per-render | low |
| `src/ts/process/scripts.ts:215` | algorithmic | Fresh `RegExp` compiled per regex script per `executeScript`; `<cbs>` scripts also `safeStructuredClone`d — small bounded data | per-token | low |
| `src/lib/UI/PromptDataItem.svelte:49` | full-state-serialize | `JSON.stringify` + two `clonePromptItem` of a single bounded PromptItem per keystroke | per-keystroke | low |
| `src/ts/observer.svelte.ts:118` | deep-clone | Full Claude request body (per Claude send, gated behind OFF-by-default experimental flag) | per-send | low |
| `src/ts/cbs.ts:376` | deep-clone | A single Message per iteration (clone+parse+stringify) for the history CBS functions | per-render | low |
| `src/ts/characters.ts:904` | deep-clone | `currentCharacterStateSnapshot()` full characters array for a single `trashTime` scalar (trash branch) | rare | low |
| `src/lib/ChatScreens/ChatBody.svelte:208` | render | `console.log` of the full assets array for every `<img>` in every rendered message | per-render | low |
| `src/lib/ChatScreens/Suggestion.svelte:73` | algorithmic | `[...messages, ...requestChat.message]` shallow copy of the whole message array, then `.slice(-10)` | per-send | low |
| `src/lib/SideBars/SideChatList.svelte:444` | algorithmic | `chara.chats.filter(...)` twice per folder + `indexOf` O(chats) scan per chat → O(folders×chats)+O(chats²); scalar reads only | per-render | low |
| `src/ts/process/promptBudget/preflightTemplateTokens.ts:61` | deep-clone | Individual bounded prompt slot arrays (persona/description/authorNote) | per-send | low |
| `src/ts/process/promptAssembly/renderFinalPrompt.ts:141` | deep-clone | Bounded prompt slot arrays + memory card array | per-send | low |
| `src/ts/process/promptAssembly/normalizeTemplate.ts:11` | deep-clone | `DBState.db.promptTemplate` (config-sized, not message-sized) | per-send | low |
| `src/ts/process/scripts.ts:338` | deep-clone | A single regex/customscript entry (small config object) | per-render | low |
| `src/ts/process/request/openAI/requests.ts:147` | deep-clone | A single multimodal user message (may include base64 image refs) | per-send | low |
| `src/ts/process/modules.ts:515` | deep-clone | A module (lorebook+regex+trigger) + concatenated character lore/script/trigger arrays (config-sized) | rare | low |
| `src/ts/plugins/plugins.svelte.ts:506` | deep-clone | `db.plugins` (all plugin code blobs); config-sized | on-load | low |
| `src/ts/realm.ts:18` | deep-clone | Full current character (with hydrated chats) for Realm export | rare | low |
| `src/lib/Playground/PlaygroundMenu.svelte:50` | deep-clone | Full character (with hydrated chats) for a temporary utility-bot | rare | low |
| `src/ts/process/request/serverMessagePatch.ts:9` | deep-clone | A single message (9), a messages array (13), scriptstate (59) on server-backed patch/restore | per-send | low |
| `src/lib/Setting/Pages/BotSettings.svelte:346` | deep-clone | Settings draft values (presets/templates/personas/modules/lorebook); config-sized, no chat data | per-click | low |
| `src/ts/chatCommands.ts:579` | deep-clone | Single rows for command patches (one message / one chat-with-history / one character / one settings value) | per-click | low |
| `src/ts/pluginCommands.ts:33` | deep-clone | Plugin defs, custom-storage maps, MCP tokens, colorScheme, and risuaccess per-char lore/scripts/triggers | per-click | low |
| `src/lib/SideBars/Scripts/TriggerV2List.svelte:1622` | deep-clone | Trigger effect blocks / GUI tree nodes / script-trigger drafts / lorebook entries / prompt items / a character (editor working copies) | per-click | low |
| `src/ts/storage/database.svelte.ts:2252` | deep-clone | Bot-preset config sub-objects + default templates (config-sized, no message data) | rare | benign |
| `src/ts/process/sendChatPromptAssembly.ts:207` | deep-clone | `DBState.db.formatingOrder` (small array of section-name strings) | per-send | benign |
| `src/ts/characterCards.ts:601` | deep-clone | Whole characters / card extensions / ccAssets / lore extentions on card import/export | rare | benign |
| `src/lang/index.ts:14` | deep-clone | Full English language string pack (localization object) | on-load | benign |
| `src/ts/gui/colorscheme.ts:156` | deep-clone | A color scheme object (small palette config) | rare | benign |
| `src/ts/persona.ts:208` | deep-clone | A persona card / loadout / single LLMModel definition (small config) | rare | benign |
| `src/ts/setting/utils.ts:100` | deep-clone | A single settings root value keyed by name | per-click | benign |
| `src/lib/SideBars/DevTool.svelte:69` | deep-clone | Preview formated prompt (69) + scriptstate patch values (136/170), dev tools | rare | benign |
| `src/lib/Others/WelcomeRisu.svelte:115` | deep-clone | Welcome-setup snapshot / Iris dialogue / preset template / full db export | rare | benign |
| `src/ts/polyfill.ts:19` | deep-clone | N/A — the clone primitive definition (`structuredClone` with rfdc fallback); cost determined by callers | unknown | benign |
| `src/lib/SideBars/CharConfig.svelte:482` | deep-clone | N/A — per-file definition of the JSON-roundtrip clone helper; cost determined by call sites | unknown | benign |

\* Severity reflects the inventory entry; these were investigated and the working severity was adjusted (see "Investigated but not flagged").

## Investigated but not flagged

These candidates were verified and rejected or downgraded; recorded so future readers do not re-investigate.

- **`buildMemoryWindow` full-characters clone to persist `lastMemory`** (`buildMemoryWindow.ts:139`) — the clone is genuinely oversized, but the heavy branch is selected only when `canUseServerCommands()` is true AND the local assembler runs. On the default fastify route, supported text sends are server-mandatory (`resolveServerPromptAssembly` returns only `server`/`unsupported`, never `local`), so the local assembler does not run for sends; in legacy web mode `canUseServerCommands()` is false and the cheap scalar write is taken instead. The heavy clone requires a contradictory combination the routing prevents → latent foot-gun, not a live per-send freeze. **Downgraded to low.**

- **`requestChatData` clones the full assembled prompt 2–3×** (`request.ts:247`) — real micro-redundancy (the 247/254 double clone in the single-model case), but on the default fastify branch `resolveServerPromptAssembly` returns `server`, the provider request runs server-side, and the client `requestChatData` clone is skipped; the frequently-hit callers (translator, triggers, stableDiff, mcp) carry small bounded prompts, not the chat blob. Large-data and hot-path never coincide. **Downgraded to low (inventory only).**

- **`loadLoreBookV3Prompt` clones the combined lorebook entry set per send** (`lorebook.svelte.ts:166`) — reached only via the local assembler, which the default `server` route skips; lorebook entries are scalar text (no nested message histories), orders of magnitude smaller than the reference-fix blob. The naive "operate by reference" fix would also be a correctness regression (the child-mode branch mutates entries in place). **Downgraded to low.**

- **`chatTemplate` clones the full prompt array for instruct/jinja models** (`chatTemplate.ts:40`) — per-send, once per request, only for local/instruct-template providers; the cloned array is context-window-bounded plain text (multimodal base64 is discarded for these text-completion endpoints). Single-digit ms, no freeze. **Benign.**

- **Per-message `markParsing` lodash `isEqual` over the character's asset/script arrays** (`ChatBody.svelte:79`) — `createSimpleCharacter` copies array *references*, so `isEqual` hits its recursive `===` fast-path and never deep-walks the large arrays. Benchmarked: 30 calls on the heaviest real character = 0.20 ms; the expensive deep walk only occurs comparing reference-distinct-but-equal large arrays, which arises only at cold paths (card import, full DB replace). **Benign.**

- **`currentPersonaStateSnapshot` clones the whole personas array twice per keystroke** (`PersonaSettings.svelte:68`) — the double-clone anti-pattern is real, but a persona is a few small string fields (`icon` is a short assetId reference, not bytes); the personas array is at most tens of KB on a Settings sub-page. Sub-millisecond, no visible stall. **Downgraded to low (cheap cleanup, not a freeze risk).**

- **`protocolDiagnostics.ts:159` `structuredClone(diagnostics)`** — a small bounded counters object accessed by a rare getter. **Benign.**

## Recommended remediation order

1. **Fix the projection write guard (`projectionWriteGuard.svelte.ts:115/119`) — highest leverage.** Eliminate the two full-`Database` deep clones per guarded write via copy-on-write / proxy unwrap-rewrap (mutate the underlying source in place; re-wrap with a freshly-minted read-only proxy so Svelte sees a new identity). This single change removes the per-token streaming freeze (`streamResponse.ts:129`), the non-stream completion clones (`nonStreamResponse.ts:116`), the SSE-apply clones (`database.svelte.ts:803`), the chat-open hydration clones (`database.svelte.ts:886`), and the guard half of the prompt-template keystroke cost — it benefits ~100 call sites at once. Interim mitigation if the proxy swap is risky: drop the refreeze-time `$state.snapshot` (halves the cost).

2. **Consolidate the `current*StateSnapshot` family into scalar/single-row/single-chat snapshot+restore helpers.** Introduce, in `chatCommands.ts`/`characterCommands.ts`/`lorebookBridge.svelte.ts`/`scriptDefinitionBridge.svelte.ts`, narrow snapshot/restore pairs mirroring `c9e728b1`'s `CharacterSelectionSnapshot`/`restoreCharacterSelection`:
   - `currentChatScopedSnapshot()`/`restoreChatScopedState()` — clones only the active chat's `message[]`, for message edits/deletes/bookmarks/replace/send.
   - `ChatScriptstateSnapshot`/`restoreChatScriptstate()` — clones only the active chat's `scriptstate`, for `setVar`/`setChatVar`/`command.ts` scriptstate writes and `v2SetAuthorNote` (extend with the note scalar).
   - `CharacterRowSnapshot`/`restoreCharacterRow()` — clones only one character row, for `setCurrentCharacter`/`setCharacterByIndex`/character field edits.
   - `currentGlobalLorebookStateSnapshot`/`restoreGlobalLorebookState` and reuse of the existing `scopedLorebookStateSnapshot` for the trigger lorebook paths.
   Reserve the full-array `current*StateSnapshot` only for genuine restructures (create/delete/reorder/fork). Add regression tests asserting the hot paths never clone every character.

3. **Apply the narrow snapshots to the Critical/High `currentChatStateSnapshot` call sites:** the chat-metadata watcher (`chatBridge.svelte.ts:68`, the per-render Critical), `chatCommands.ts:73`, `DefaultChatScreen.svelte:215/783`, `Chat.svelte:144/258`, `rerollNavigation.svelte.ts:83/95/147`, `command.ts:336`, `lorepreset.svelte:28`. For the watcher, also capture the rollback lazily only when a change is detected, and rewrite `scalarChatMetadata` (`chatBridge.svelte.ts:190`) to pick `CHAT_PATCH_ALLOWED_KEYS` directly without serializing `chat.message`.

4. **Fix the cheap, high-confidence wins:** the one-line `recordGeneratedReroll` slice/clone reorder (`rerollNavigation.svelte.ts:60`), the redundant `safeStructuredClone(record.message)` at `rerollNavigation.svelte.ts:105`, and the `runTrigger` early-return-before-clone + char/chat double-clone narrowing (`triggers.ts:1198`).

5. **Fix the script-definition watcher (`scriptDefinitionBridge.svelte.ts:228`)** to stop deep-reading characters/modules per fire — keep only the per-key collection stringify for change detection and build the rollback lazily/scoped in `dispatchWatchedReplacement`.

6. **Debounce the per-keystroke prompt-template projection write (`PromptSettings.svelte:196`)** and mutate only the edited item; replace the double `JSON.stringify` change-detection (`:358`) with a server-revision discriminator.

7. **Scope the lorebook watcher (`lorebookBridge.svelte.ts:427`)** to the mounting panel's collection (cut the all-chats-of-all-characters `localLore` loop).

8. **Opportunistic cleanups (low priority):** shallow-spread the CBS history clones (`cbs.ts:376/399/1687`), shallow-spread the Claude observer body (`observer.svelte.ts:118`), narrow the character image/emotion snapshots (`characters.ts:138…`), memoize compiled regexes in `scripts.ts`, and the `{{#each}}` re-injection rewrite (`risuChatParser.ts:638`).

**General principle (from the reference fix):** never deep-clone the whole characters array, the whole `Database`, or full message histories on scalar-only or hot paths. Prefer scalar / single-row / single-chat / structural-share snapshots, and reserve the full-collection clone for operations that genuinely restructure the collection (create/delete/reorder/fork). An optimistic-rollback baseline only needs to restore what the command actually mutates.
