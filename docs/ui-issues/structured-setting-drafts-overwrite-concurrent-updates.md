# Structured setting drafts overwrite concurrent subfield updates

## Summary

`createServerBackedSettingDraft` treats every setting root as one dirty value. For structured roots that contain independently editable rows or fields, a local edit and an authoritative update to a different subfield do not merge. The draft deliberately restores its complete pre-update value over the resource projection, and its debounced command sends that complete value with a fresh server revision. Fastify accepts it and durably erases the unrelated update.

Custom Models provides the clearest user-facing example, but the same draft/queue contract is used by Hypa V3 preset rows, custom sidebar rows, banned-character sets, stop strings, additional parameters, custom flags/model tools, and many non-sparse provider/media configuration objects. Only `NAIImgConfig`, `wavespeedImage`, and `seperateParameters` use the bridge's sparse-object queue.

This is a lost-update race between different logical sub-owners, not the older-acknowledgement race documented in `settings-draft-older-ack-clears-newer-dirty-state.md`. It requires no stale response for the destructive local edit: a valid same-writer update from another draft owner arriving before that edit's debounce fires is enough.

## Location

- Generic whole-setting draft synchronization: `src/ts/server/settingsBridge.svelte.ts:103-104,137-268,282-290`
- Absolute settings-patch queue: `src/ts/server/settingsBridge.svelte.ts:451-568,680-850`
- Custom-model representative: `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:18-54,71-267`
- Hypa V3 preset representative: `src/lib/Setting/Pages/OtherBotSettings.svelte:89-99,1337-1473`
- Other array consumers: `src/lib/Others/CustomSidebarConfig.svelte:14`; `src/lib/Setting/Pages/Advanced/BanCharacterSetSettings.svelte:7`; `src/lib/Setting/Pages/BotSettings.svelte:154,161,231,235`
- Settings group mapping: `src/ts/server/settingsGroups.ts`
- Client request: `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify validation, persistence, and acknowledgement: `server/fastify/src/routes/commands.ts:1844-1907,8344-8364,8547-8567`
- Authoritative group projection and local acknowledgement: `src/ts/server/resourceState.svelte.ts:728-826`

## Trigger

Using Custom Models in two duplicated browser tabs that share the same active-writer session:

1. Both duplicated tabs start with custom models **A** and **B**.
2. In tab 1, edit **A**'s URL, name, request model, parameters, format, tokenizer, key, or flags. Its editor creates a dirty array containing edited **A** and old **B**, then waits 250 ms before dispatch.
3. Before tab 1's debounce fires, edit **B** in tab 2. Tab 2 now owns a dirty array containing old **A** and edited **B**, with a slightly later debounce.
4. Let tab 1's earlier command succeed and let its authoritative `providers` update reach tab 2 before tab 2's debounce fires.
5. Let tab 2's pending command dispatch.

Equivalent examples are editing Hypa preset **A** while the duplicated tab edits/adds/deletes preset **B**, or adding one banned script/stop string in each tab. Independently opened sessions do not provide this trigger: Fastify's active-writer lease rejects the stale writer with HTTP 423. The collision requires one accepted writer lineage, such as a duplicated tab that inherited the same session identifier, or separate complete-root draft owners within that lineage.

## Expected behavior

Edits to different stable row IDs or object paths should merge. Tab 1's pending change to **A** should remain visible while tab 2's accepted change to **B** is adopted, producing a value containing both changes. Independent set additions should both survive. If operations are genuinely ambiguous, the later command should receive a conflict instead of silently replacing a successful update.

## Actual behavior

Tab 2 preserves its local edit, but it does so by restoring the entire stale structured value. Tab 1's accepted **A** value briefly reaches tab 2's resource projection and is immediately replaced with old **A**. When the later debounce fires, tab 2 sends that stale composite; the command obtains the latest base revision, so Fastify accepts it as an ordinary successor.

For Custom Models, both tabs converge on `[old A, new B]`. Add, delete, and reorder collisions can resurrect deleted rows or discard new ones. For objects, a locally dirty field can restore stale values for sibling fields. For string/set arrays, one tab's addition can erase another's.

Hypa's specialized rollback does not prevent this race. It preserves unrelated live rows when a command itself fails; it does not rebase a dirty draft over a successful incoming resource update before an accepted command.

## Underlying cause

The abstraction records one `dirty` boolean and one attempted JSON value for the complete root setting. At `src/ts/server/settingsBridge.svelte.ts:182-190`, any differing resource apply while that root is dirty calls `reassertDirtySettingDraftValue(key, draft.value)`. That helper writes the complete local value back into the shared settings projection. It has no baseline diff, touched-path set, row identity, or merge policy.

The queue likewise records one absolute value per setting key. Its sparse merge path is restricted to three named object settings and does not support ID-addressable arrays or the other structured objects. A staged durable intent therefore remains stale after a newer group projection arrives.

Revision checking does not prevent the loss. The command's base revision is read when the debounced command executes, after the foreign update, so the stale absolute value is a valid successor to the latest server revision. The generic Fastify route validates the JSON kind, assigns the complete setting, writes it, and acknowledges the key without sub-owner conflict information.

## Affected data flow

1. **UI interaction:** a row/field control mutates or replaces part of a structured draft. Custom Models clones its array and replaces one indexed record; Hypa preset and provider controls similarly mutate a root collection/object.
2. **Client projection:** the draft writes the complete attempted root into the settings resource and marks only the root owner dirty.
3. **Same-writer synchronization:** the other duplicated tab persists an independent subfield update. The receiving tab applies the newer settings group through `applySettingsGroupResource`.
4. **Incorrect rebase:** the dirty-draft effect observes a differing authoritative root and reasserts the complete local root, restoring every stale sibling value.
5. **Request:** after the debounce, `patchServerBackedSettings` sends `PATCH /api/v1/commands/settings/:group` with that absolute root and a current base revision.
6. **Server persistence:** Fastify replaces `database[key]`, writes the settings row (and the Hypa preset collection table when applicable), and emits `settings.updated`.
7. **Acknowledgement/display:** the response names the root in `acknowledgedKeys`; the local effect or later group read settles the draft. Editors and runtime consumers converge on the destructive accepted value, so no remaining inconsistency exposes the lost update.

## Severity and user impact

**High.** A successful edit can be silently and durably erased by an unrelated edit to another row or field. Affected data includes model endpoints/credentials/capabilities, memory presets, sidebar configuration, request parameters, safety filters, model tools, and stop strings. Structural collisions can resurrect deleted configurations or discard newly added ones. All clients eventually converge, making the loss look like the earlier successful change was never saved.

## Recommended fix

Structured settings need sub-owner mutation contracts. For ID-addressable collections, add create, patch-by-ID, delete-by-ID, and reorder-by-ID commands. For objects, generalize the existing sparse object route to explicit set/delete paths with owner revisions. For set-like arrays, use add/remove item operations. Fastify should apply each operation against the latest structure and return the canonical affected paths/rows plus an owner revision or certificate.

As an interim client fix, retain the authoritative baseline, current draft, and exact locally touched paths/row IDs. On a resource update, perform a three-way rebase: preserve foreign sibling changes/additions/deletions, reapply only local edits, reject ambiguous reorder/delete collisions, update the visible projection, and rebuild the staged outbox body. Merely reasserting the visible draft is insufficient because the durable intent already contains stale JSON.

Add bridge-level regression tests for an ID-addressable array, a set-like array, and a nested object: edit sub-owner **A**, apply an authoritative **B** update before debounce, dispatch, and assert request/final projection contain both. Cover add/delete/reorder ambiguity. The current draft tests explicitly assert complete dirty-value reassertion, and representative component tests mock the draft rather than exercising resource/command synchronization.
