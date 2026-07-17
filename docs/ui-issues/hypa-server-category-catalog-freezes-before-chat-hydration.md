# Hypa server mode freezes its category catalog before chat hydration

## Summary

The server-backed Hypa modal loads summary rows from Fastify, but still obtains category definitions from legacy `chat.hypaV3Data`, which arrives later with chat-message hydration. When the modal opens before that hydration completes, it snapshots the default/empty category list and deliberately stops tracking the legacy value. The eventual hydration updates the chat but not the mounted modal. Persisted summary `categoryId` values then have no matching option, so the UI displays a blank/unclassified selection and changing it can erase the valid server assignment.

## Location

- `src/lib/Others/HypaV3Modal.svelte:47-83,85-168,313-365,1126-1140,1223-1245,1282-1290`
- `src/lib/Others/HypaV3Modal/modal-summary-item.svelte:581-603`
- `src/lib/Others/HypaV3Modal/server-summary-patch.ts:6-23`
- `src/ts/process/request/serverMemory.ts:32-48,181-227,245-276`
- `server/fastify/src/routes/memoryReads.ts:45-76,78-164`
- `server/fastify/src/memoryLegacyImport.ts:191-205`
- `src/ts/server/chatMessageHydration.svelte.ts:330-382,542-580`
- `src/ts/storage/database.svelte.ts:3175-3205,3320-3360`
- `server/fastify/src/routes/resourceReads.ts:362-437`

## Trigger

1. Use a chat whose legacy Hypa data defines a category such as `{ id: "story", name: "Story" }` and whose migrated server summary metadata contains `categoryId: "story"`.
2. Reload or otherwise start from a message-free character/chat shell.
3. Open the Hypa V3 modal from character configuration (or any path not gated on completed transcript hydration) before `/api/v1/chats/:id/messages` has applied `hypaV3Data`.
4. Let `/api/v1/memory/summaries/:chatId` resolve, then let chat hydration apply the category definitions.
5. Inspect or change the summary's category selector.

## Expected behavior

Summary metadata and its category definitions should reconcile under the same chat owner. When the category catalog hydrates, the already-loaded summary should display “Story” without refetching or losing dirty row edits. A category id that is temporarily absent from the catalog should remain visible as an unknown/raw option and must not be converted to “unclassified” merely by rendering the control.

## Actual behavior

The summary response retains `categoryId: "story"`, but the selector contains only the default category because the modal captured categories before hydration. The selected value has no matching `<option>`, so the row appears blank or unclassified. The category manager is hidden in server-backed mode, and the same-chat hydration does not repair the modal; closing and reopening it after hydration is the practical recovery. Selecting the only visible option sends `categoryId: null`, permanently deleting the server's valid category assignment.

## Underlying cause

Server memory owns summary rows and their metadata, but not the corresponding category definitions. Legacy import copies each summary's `categoryId` into server memory metadata while categories remain embedded in `chat_hypa_v3`. The initial character resource deliberately carries message-free chat shells; `hypaV3Data` is applied later by chat-message hydration.

Before the migration, the modal derived both summaries and categories reactively from the same `chat.hypaV3Data` object. The server-mode branch split those owners, then converted the remaining legacy half into a one-time snapshot.

In `HypaV3Modal`, the server-summary effect is keyed by server mode and `currentChatId`. It calls `cloneLegacyCategories()` inside `untrack()`, assigns that one snapshot to `serverHypaV3Data.categories`, and passes it into the summary request. `refreshServerSummaries()` reuses the same snapshot in the completed projection. Since category reads are untracked and the chat id has not changed, later hydration of `currentChat.hypaV3Data` does not rerun or update the effect.

Server-backed summary rows remain editable (`readOnly={false}`). Their category `<select>` is populated only from the frozen array and maps an empty selection to `undefined`; `handleServerSummaryChanged` converts that into a PATCH whose `categoryId` is null. Fastify correctly interprets null/empty as deletion, making the incorrect projection capable of corrupting otherwise valid persisted metadata.

## Affected data flow

1. **Initial client projection:** Bootstrap/character refresh supplies a chat shell with no resident `hypaV3Data`; the modal's derived legacy data falls back to `createInitialHypaV3Data()`.
2. **UI action:** The user opens Hypa V3. The server-mode effect snapshots that fallback catalog and calls `listServerMemorySummaries(chatId)`.
3. **Server read:** `GET /api/v1/memory/summaries/:chatId` returns durable summaries, including each migrated `metadata.categoryId`, but no category definitions.
4. **Client reconciliation:** `serverSummaryView()` copies the category id into the row, while `refreshServerSummaries()` attaches the pre-hydration category snapshot to the modal projection.
5. **Independent hydration:** `GET /api/v1/chats/:id/messages` returns messages and `hypaV3Data`; `hydrateServerChatMessages()` updates the current chat's legacy categories.
6. **Missing synchronization:** The modal's `untrack()` prevents that same-owner category update from reaching `serverHypaV3Data`, so the row and selector display inconsistent halves of the durable data.
7. **Optional mutation:** Choosing the visible unclassified option invokes `patchServerMemorySummary(summaryId, { categoryId: null })`; Fastify deletes `metadata.categoryId` and acknowledges `{ summaryId }`. The modal then treats the destructive update as successfully persisted.

## Severity and user impact

**Medium-high.** The race is most likely during startup, after a full resource reset, or on slower servers. It misrepresents durable memory organization, makes category filters unreliable, and can turn a display/hydration defect into permanent metadata loss through an ordinary selector action. Server mode hides category management, so users receive no explanation or in-modal recovery.

## Recommended fix

Move category definitions into a server-owned memory/chat-category resource, ideally returned with or revision-coupled to the summary list. If legacy chat hydration remains the temporary source:

- Track a category-catalog owner/version separately from the summary-list request rather than `untrack()`-ing it.
- When `hypaV3Data` for the same chat hydrates, reconcile only `serverHypaV3Data.categories`; do not replace dirty summary row objects or restart an unrelated list request.
- Preserve the current category id with a fallback option (for example, `Unknown category (story)`) whenever the catalog has not caught up.
- Disable category mutation until the catalog is known to be hydrated, and never normalize an unmatched value to null implicitly.
- Include category version/identity in any future PATCH validation so a stale catalog cannot erase a category created or renamed elsewhere.

## Test coverage gap

Existing server-reliability tests seed `hypaV3Data` before mounting the modal, so they cannot expose this ordering. Add a mounted test with a chat shell lacking `hypaV3Data`, resolve a summary containing `categoryId: "story"`, then apply same-chat hydration with the Story category. Assert that the option/name appears without remounting and that no PATCH is sent. Also test an unmatched category id and require a non-destructive fallback until the catalog arrives.
