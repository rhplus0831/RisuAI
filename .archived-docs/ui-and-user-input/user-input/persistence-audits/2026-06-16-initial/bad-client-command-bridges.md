# Client Command / Bridge Persistence Audit

Status: bad

Scope audited:

- `src/ts/*Commands.ts`
- `src/ts/server/*Bridge*.ts`
- `src/ts/server/projectionWriteGuard.svelte.ts`
- `src/ts/server/commands.ts`

## Finding

### Likely: global lorebook selection is dispatched without the required optimistic projection write

`src/ts/server/lorebookBridge.svelte.ts:772` defines `selectGlobalLorebook(index)`. When server commands are available and the target lorebook has an id, it calls `dispatchSelectGlobalLorebook(...)` and returns at `src/ts/server/lorebookBridge.svelte.ts:774-776`. The local `DBState.db.loreBookPage = index` write only happens in the fallback branch at `src/ts/server/lorebookBridge.svelte.ts:779-781`.

That is inconsistent with sibling selection helpers, which pre-apply local state and then dispatch the command:

- Character selection writes `currentChar` / `selectedCharID` before `dispatchSelectCharacter` at `src/ts/characters.ts:1056-1066`.
- Chat selection writes `chatPage` before `dispatchSelectChat` at `src/ts/globalApi.svelte.ts:1887-1892`.

This matters because own command events do not re-apply the projection. `processServerCommandEvent` treats an own event as already applied, updates the cached revision, and returns at `src/ts/bootstrap.ts:335-338`. So a successful `/lorebooks/:id/select` command can persist `loreBookPage` server-side while the originating tab remains on the old selected lorebook until a later full projection refresh.

Suggested fix:

- In `selectGlobalLorebook(index)`, capture `previous = currentGlobalLorebookStateSnapshot()`, then set `DBState.db.loreBookPage = index` inside `withTrustedServerProjectionWrite` before dispatching `dispatchSelectGlobalLorebook(lorebookId, previous)`.
- Keep the existing rollback path in `dispatchSelectGlobalLorebook`; it already restores the narrow global-lorebook snapshot on command failure at `src/ts/server/lorebookBridge.svelte.ts:895-904`.

Suggested tests:

- Add a `src/ts/server/lorebookBridge.svelte.test.ts` case where `DBState.db.loreBookPage` starts at `0`, `selectGlobalLorebook(1)` is called with an id-backed second lorebook, and the test asserts `loreBookPage === 1` immediately before any mocked command/event response.
- Add a command-failure variant proving the rollback restores the previous `loreBookPage`.
- Add a source/completeness guard similar to the existing lorebook tests to assert `selectGlobalLorebook` contains both the trusted write and `dispatchSelectGlobalLorebook`.

## Audit Notes

- Optimistic helper API pattern: Several dispatch helpers intentionally assume callers have already applied local state. Most call sites follow that pattern; the global lorebook selection helper above does not.
- Patch sanitizers: The audited sanitizers intentionally drop ids / server-owned nested fields (`sanitizeCharacterPatch`, `sanitizeChatPatch`, `sanitizeModulePatch`, `sanitizePluginPatch`) and I did not find evidence of valid user-content fields being dropped in this slice.
- Debounce / flush: The bridge queues expose flush helpers and `src/ts/server/bridgeFlush.ts:9-15` aggregates settings, character, chat, lorebook, prompt-template, and script-definition flushes. Lifecycle keepalive flush is installed via `pagehide` / hidden visibility at `src/ts/server/bridgeFlush.ts:21-34`.
- Body-cache / revision: `src/ts/server/commands.ts:1141-1173` seeds the base revision from bootstrap when needed, and command responses / 409s update the cached revision at `src/ts/server/commands.ts:2890-2912`. I did not find a revision-cache gap in the audited command wrapper path.
