# Character draft overwrites quick-added assets

## Summary

The character editor and the chat sticker picker maintain different versions of the same character row. If a user quick-adds an additional asset from the chat and edits another character field before the asset patch is acknowledged, the character editor can copy its stale `additionalAssets` list back into the live projection and subsequently persist removal of the new asset.

## Location

- `src/lib/ChatScreens/AssetInput.svelte:45-118,120-143`
- `src/lib/SideBars/CharConfig.svelte:148-199,247-259,1543-1607`
- `src/ts/server/characterBridge.svelte.ts:80-135,137-166,246-330`
- `src/ts/storage/database.svelte.ts:3434-3447`
- `src/ts/characterCommands.ts:1041-1068,1156-1168`
- `src/ts/server/commands.ts:3321-3335`
- `src/ts/server/resourceState.svelte.ts:2232-2253`
- `server/fastify/src/routes/commands.ts:4912-4964`

## Trigger

On a desktop layout where the main chat and Character sidebar are both usable:

1. Open the Character editor for the active character.
2. Open the chat sticker picker and quick-add an additional asset.
3. Before the first character PATCH acknowledgement is reconciled, edit any field in `CharConfig`, such as the character name or description.

## Expected behavior

The quick-added asset and the later character-field edit should merge. Both components should immediately show the new asset, and both changes should remain persisted.

## Actual behavior

The sticker picker updates the live character row, while `CharConfig` continues to display its older draft list. The next unrelated editor change reapplies the full stale draft to the live character. The newly added asset can disappear from both components and a later debounced PATCH can persist the old asset list.

## Underlying cause

`CharConfig` places `additionalAssets` in a separate server-backed character draft (`CharConfig.svelte:148-199`) and renders its asset list from that draft (`CharConfig.svelte:1543-1607`). Quick-add instead clones the current live character, appends assets, and calls `setCharacterByIndex` (`AssetInput.svelte:99-118`), which replaces the live row and immediately dispatches a compatible character patch (`database.svelte.ts:3434-3447`; `characterCommands.ts:1156-1168`).

The draft seed effect observes the row assignment but returns unless the character identity or broad server-resource apply epoch changed (`characterBridge.svelte.ts:80-95`). A trusted optimistic write does not itself advance that epoch. If the user then changes one draft field, the draft effect sanitizes and `Object.assign`s the entire draft, including the stale clean `additionalAssets` field, onto the live row (`characterBridge.svelte.ts:137-166`). The mounted profile watcher detects that projection and merges it into its debounced durable patch (`CharConfig.svelte:247-259`; `characterBridge.svelte.ts:246-330`).

## Affected data flow

1. **UI:** `AssetInput` selects and stores files, then appends their references to the live character (`AssetInput.svelte:45-143`).
2. **Client state:** `setCharacterByIndex` replaces the character projection and dispatches the first scoped patch (`database.svelte.ts:3434-3447`). `CharConfig`'s same-owner draft is not updated yet.
3. **Race:** A second editor action changes the draft before acknowledgement. The whole stale draft is assigned over the live row (`characterBridge.svelte.ts:137-166`).
4. **Client request:** The profile watcher queues a combined/debounced character update, potentially including the old `additionalAssets` value (`characterBridge.svelte.ts:286-330`). Both paths use `PATCH /api/v1/commands/characters/:characterId` (`commands.ts:3321-3335`).
5. **Server persistence:** Fastify validates the patch, builds the patched character row, and writes it to SQLite (`server/fastify/src/routes/commands.ts:4912-4964`). A later stale-list patch can therefore overwrite the earlier asset reference.
6. **Response:** Accepted optimistic character acknowledgements only fence the row revision and deliberately do not reapply fields (`resourceState.svelte.ts:2232-2253`), so they do not recover the lost asset from an authoritative response body.
7. **Display:** `AssetInput` reads the live row while `CharConfig` reads its draft; they can disagree during the race, then converge on the stale list after the draft reassertion.

## Severity and user impact

**High.** A successfully uploaded asset reference can be silently removed and the removal persisted. The user may only notice later, after the asset disappears from the sticker picker or a reload, and may need to upload it again.

## Recommended fix

Give character drafts a per-character local-mutation signal in addition to the authoritative resource-apply epoch. Merge same-owner optimistic projection changes into fields that are not dirty immediately. When applying editor changes, write and queue only top-level fields changed in the draft rather than `Object.assign`ing the complete sanitized draft. The quick-add path should also avoid being persisted twice by both its immediate command and the generic profile watcher.

## Test coverage gap

`src/ts/server/characterBridge.svelte.test.ts:223-417` covers character switches, authoritative resource applies, and dirty-field preservation, but not a same-owner optimistic row replacement from another component. Add a race test that starts with asset A, quick-adds asset B through the live-row path, edits a clean draft field before acknowledgement, resolves both commands in order, and asserts that A and B remain in the client projection and persisted patch.
