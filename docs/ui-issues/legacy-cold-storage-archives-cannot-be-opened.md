# Legacy cold-storage archives cannot be opened

## Summary

Characters and chats archived by the pre-Fastify cold-storage feature remain represented in the migrated database by pointers to compressed sidecar files. The current client deliberately refuses to read either kind of pointer. Archived characters cannot be selected, while archived chats render an empty transcript after displaying an error, even though the Fastify legacy-storage API can still read the sidecar key format.

## Location

- `src/ts/process/coldstorage.svelte.ts:20-40,196-210`
- `src/ts/characters.ts:1449-1485`
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1694-1701`
- `src/ts/storage/fastifyStorage.ts:158-253`
- `server/fastify/src/routes/legacyStorage.ts:90-192`
- `server/fastify/__tests__/legacyStorage.test.ts:259-285`
- Pre-migration reference: `/home/codex/Risuai/src/ts/process/coldstorage.svelte.ts:32-93,491-529`

## Trigger

1. Migrate or start Fastify with data created by a version that had cold storage enabled.
2. Select a character whose row has a `coldstorage` key, or open a chat whose first message starts with `coldStorageHeader`.

## Expected behavior

The archived payload should be recovered from `coldstorage/<key>`, decompressed and validated, then shown in the selected character/chat. In the migrated architecture, the recovered data should also be committed to the authoritative SQLite character, chat, and message tables before its pointer is cleared. If recovery is impossible, the UI should retain the pointer and clearly identify the missing/corrupt archive.

## Actual behavior

- `changeChar` displays “Cold-storage character hydration is not supported…” and returns before selecting the character or making any request.
- `preLoadChat` displays a similar error and returns. `DefaultChatScreen` then enters the `{:then}` branch and renders only an empty `<div>`, so the transcript disappears.
- No recovery mutation is sent and the pointer remains authoritative across reloads.

## Underlying cause

All current storage adapters in `coldstorage.svelte.ts` are stubs: reads return `null`, writes return `false`, lists are empty, and cleanup/removal do nothing. Both UI entry points add explicit early-return gates around these stubs.

This is not forced by the Fastify transport. `FastifyStorage` still implements authenticated read, write, list, and remove operations, and `legacyStorage.ts` serves those operations from the legacy save directory. Its route test explicitly writes and lists a `coldstorage/abc` key. The pre-migration Node implementation used the same `coldstorage/<key>` namespace, decompressed the bytes with `fflate`, and restored the archived message and chat metadata.

## Affected data flow

### Archived character

1. **UI interaction:** The user clicks the archived character in the character list.
2. **Client projection:** The list row contains the lightweight character shell and its `coldstorage` key.
3. **Client gate:** `changeChar` detects the key and returns before changing `selectedCharID`.
4. **Missing request:** No `GET /api/v1/storage/read` request is made for `coldstorage/<key>` and no character-hydration request is attempted.
5. **Missing persistence:** No targeted server command replaces the shell with recovered character/chat rows or clears the marker.
6. **Displayed state:** The old selection remains active and the archived character is unusable.

### Archived chat

1. **UI interaction:** The user opens a chat whose hydrated first message is a cold-storage pointer.
2. **Client projection:** `DefaultChatScreen` switches from the normal transcript branch to the `preLoadChat` await block.
3. **Client gate:** `preLoadChat` reports unsupported hydration without reading the sidecar.
4. **Missing request/persistence:** Fastify receives neither a legacy-storage read nor a recovery command.
5. **Displayed state:** The completed await block renders an empty element instead of the persisted pointer, recovered messages, or an actionable error row.

## Severity and user impact

**Critical for affected users.** Previously valid characters and conversation histories appear inaccessible after migration. Because the sidecar may still exist, the behavior looks like data loss even when the bytes are recoverable. Character-level archives block all chats under that character; chat-level archives hide the full transcript for the affected chat.

## Recommended fix

Implement cold-storage recovery as a server-owned migration rather than restoring browser-only mutation:

1. Detect character and chat pointers during startup/import or through an explicit recovery endpoint.
2. Read and decompress the legacy `coldstorage/<key>` sidecar under authentication, validate its shape and ownership, and transactionally write the recovered character, chat metadata, messages, memory data, script state, and local lore into SQLite.
3. Clear the pointer only in the same successful transaction. Keep the sidecar until the SQLite result has been read back and verified.
4. Return a revisioned acknowledgement and refresh only the recovered character/chat projection.
5. Preserve the pointer and show a durable error state when the sidecar is missing or corrupt.

A short-term client-assisted recovery would still need a dedicated conditional command. The generic character patch intentionally excludes `chats`, `coldstorage`, and `coldStoragedChats` (`src/ts/characterCommands.ts:152-164`), and raw projection assignment would recreate the same non-persistence problem.

## Test coverage gap

`src/ts/process/coldstorage.test.ts:76-111` and `src/ts/compatibilityAdapters.test.ts:613-626` currently assert that recovery is rejected and that no request is sent. Replace those expectations with an end-to-end migration fixture containing a real compressed legacy sidecar. Verify character selection, chat transcript restoration, SQLite persistence, reload behavior, missing/corrupt archive handling, and retention of the sidecar until recovery commits.
