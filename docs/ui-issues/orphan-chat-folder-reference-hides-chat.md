# Orphan chat folder reference hides chat

## Summary

A chat whose non-null `folderId` does not match any folder in the resident character projection is omitted from the sidebar. It is neither rendered under a real folder nor treated as ungrouped, making an existing chat appear lost.

## Location

- `src/lib/SideBars/chatFolderGrouping.ts:7-27`
- `src/lib/SideBars/SideChatList.svelte:83-91,901-1005,1119-1122`
- `server/fastify/src/commands/chats.ts:82-117`
- `server/fastify/src/routes/commands.ts:5196-5250,5664-5710`

## Trigger

Render `SideChatList` with a resident chat whose `folderId` is a non-empty string absent from `chara.chatFolders`. This can occur whenever legacy, locally mutated, or transiently inconsistent projection data bypasses or precedes Fastify's folder-reference normalization.

## Expected behavior

The chat should remain discoverable, preferably in the ungrouped list or an explicit recovered/unknown-folder group. The client may then offer to repair the reference to `null`.

## Actual behavior

The chat row is not rendered anywhere in the sidebar. Its underlying chat data can still exist and a direct route may still open it, but the list offers no way to select, rename, export, move, or delete it.

## Underlying cause

`groupChatsByFolderId` uses every non-null `folderId` as a map key (`chatFolderGrouping.ts:14-25`). `SideChatList` only consumes grouped entries while iterating folders that actually exist (`SideChatList.svelte:901-1005`). Its separate ungrouped loop requires `chat.folderId == null` (`SideChatList.svelte:1119-1122`). An unknown non-null ID therefore satisfies neither render path.

Fastify normally mitigates this by converting unknown folder IDs to `null` in `ensureCharacterChats` (`server/fastify/src/commands/chats.ts:82-117`), and its chat update route rejects new unknown IDs (`commands.ts:5196-5250`). That server invariant reduces how often the state occurs but does not make the UI derivation total for a mismatched resident projection.

## Affected data flow

1. **Persistence/hydration:** A character/chat projection reaches the client with a chat `folderId` that is absent from the same character's `chatFolders`. Canonical Fastify reads normally repair this at `commands/chats.ts:108-113`.
2. **Client state:** `SideChatList` derives `chatsByFolderId` without checking the valid folder-ID set (`SideChatList.svelte:83-85`; `chatFolderGrouping.ts:14-27`).
3. **Display:** Existing-folder loops cannot consume the orphan key, and the null-only ungrouped loop excludes it (`SideChatList.svelte:901-1005,1119-1122`).
4. **Request/response:** The UI sends no repair request. Normal chat PATCH persistence would reject the unknown folder (`commands.ts:5226-5229`), while deletion of a valid folder correctly nulls affected chat references server-side (`commands.ts:5664-5710`).

## Severity and user impact

**Medium.** The chat appears deleted even though its data remains. Impact is high for an affected chat, but Fastify's normalization makes the invalid state conditional rather than a routine command result.

## Recommended fix

Derive a set of valid folder IDs and classify any chat whose `folderId` is nullish **or unknown** as ungrouped for rendering and organization. Keep rendering recovery separate from persistence; optionally expose a repair action that sends a scoped chat patch with `{ folderId: null }` after the row is visible.

## Test coverage gap

Add a `SideChatList` DOM test with one valid folder, one correctly grouped chat, and one chat referencing a missing folder. Assert that the orphan chat appears exactly once in the ungrouped list and remains actionable. Add a grouping unit test for a caller-provided valid-folder set if the normalization is moved into `chatFolderGrouping.ts`.
