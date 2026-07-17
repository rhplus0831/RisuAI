# Alternate greeting deletion leaves other chat indices stale

## Summary

Alternate greetings are stored on the character, while each chat stores a numeric `fmIndex` into that array. Deleting a greeting resets only the currently selected chat and persists the shortened character array without updating any sibling chat. Those chats can then select a different greeting than before or retain an out-of-range index that renders and prompts as empty.

## Location

- `src/lib/SideBars/CharConfig.svelte:148-199,247-260,537-559,2251-2325`
- `src/ts/chatCommands.ts:2508-2535`
- `src/ts/server/characterBridge.svelte.ts:137-166,246-330`
- `src/ts/server/commands.ts:3321-3335`
- `server/fastify/src/commands/characters.ts:99-116`
- `server/fastify/src/commands/chats.ts:64-77,799-806`
- `server/fastify/src/routes/commands.ts:4912-4964`
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1755-1796`
- `server/fastify/src/prompt/history.ts:469-472`
- `server/fastify/src/prompt/scripts.ts:234-235,459-460`

## Trigger

1. Give a character multiple alternate greetings and create at least two chats that select alternates.
2. Keep chat A selected while chat B has `fmIndex` equal to the greeting being removed, or greater than its position.
3. Delete that greeting in Character settings and let the character draft persist.
4. Open chat B or generate from it.

## Expected behavior

Deleting an indexed greeting should preserve referential integrity for every chat owned by the character. Chats pointing after the deleted position should decrement their index; chats pointing at the deleted greeting should move to a defined fallback such as `-1`. The character update and all affected chat-row updates should succeed or roll back atomically.

## Actual behavior

The delete handler unconditionally resets only the active chat to `-1`, even if that chat selected a different greeting. Every sibling chat keeps its old numeric value. An index above the deleted position now selects the preceding array element, while deleting the last selected greeting leaves an out-of-range index. The chat UI passes `undefined` as its greeting in the latter case, and Fastify prompt builders fall back to an empty string. These states survive reload because both the shortened character array and stale chat rows are valid and durable.

Reordering greetings has the same identity problem: the array entries swap while every `fmIndex` remains numeric, so existing chats silently change which greeting they reference.

## Underlying cause

`fmIndex` is an unguarded cross-row positional reference. The Character editor owns only the character draft and has no operation that updates all child chat rows. Its delete handler calls `setCurrentChatGreetingIndex(-1)` for the current selection, then splices `alternateGreetings`; move-up/down only swap array elements.

The character profile bridge sends the complete changed `alternateGreetings` field to the character PATCH. Fastify's character patch builder deliberately uses `chats: []` for the collection row and the route writes only that character row, so it cannot cascade the edit to chat metadata. Chat validation merely requires `fmIndex` to be finite; it does not require an integer, `-1`, or an index within the parent character's current greeting array.

## Affected data flow

1. **UI action:** The user removes an alternate greeting in `CharConfig`; the handler resets the selected chat only and splices the character draft (`CharConfig.svelte:2251-2325`). Reorder actions swap array values without touching chats (`CharConfig.svelte:537-559`).
2. **Client projections:** `characterDraft.value.alternateGreetings` changes, active `chat.fmIndex` becomes `-1`, and sibling chats retain their old indices.
3. **Requests:** The profile watcher sends `PATCH /api/v1/commands/characters/:characterId` with `alternateGreetings`. The mounted chat watcher may separately persist the active chat reset, but no request contains sibling-chat corrections (`characterBridge.svelte.ts:246-330`; `commands.ts:3321-3335`).
4. **Server persistence:** Fastify builds and writes only the patched character collection row (`characters.ts:99-116`; `routes/commands.ts:4912-4964`). Existing chat rows are not inspected or rewritten.
5. **Response:** The character response returns revision/event/character ID, not corrected chat rows. The active-chat PATCH, if emitted, acknowledges only that one chat.
6. **Display and generation:** Opening a sibling chat indexes `alternateGreetings[fmIndex]` directly in `DefaultChatScreen`. Server prompt history and script assembly use the same index with an empty-string fallback (`DefaultChatScreen.svelte:1755-1796`; `prompt/history.ts:469-472`; `prompt/scripts.ts:234-235,459-460`).

## Severity and user impact

**High.** A character-level edit silently changes or erases the effective opening context of other chats. Users can see a blank/wrong greeting and generate against different server prompt context without any validation error. Multiple historical chats can be affected by one deletion, and the stale references are accepted as valid persistence.

## Recommended fix

- Replace positional greeting references with stable greeting IDs. Store a stable ID on each alternate greeting and a `greetingId` on chats, with `null` representing the primary greeting.
- Until that migration is possible, add a dedicated server command for delete/reorder that transactionally rewrites every child chat `fmIndex`, persists the character and chat rows together, and returns the corrected projection.
- Mirror the cascade optimistically with a single attempt token and rollback all affected rows together. Do not unconditionally reset the active chat when an unrelated position is deleted.
- Tighten chat validation/repair so `fmIndex` is an integer and is either `-1` or within the owning character's current array bounds. Repair invalid legacy values to `-1` rather than rendering `undefined`.

## Test coverage gap

Add an integration fixture with several chats selecting positions before, at, and after a deleted greeting. Assert the expected preserved/decremented/fallback mapping in the browser and SQLite, including rollback on a rejected command. Add a reorder test that preserves greeting identity, plus read-repair tests for fractional and out-of-range legacy `fmIndex` values.
