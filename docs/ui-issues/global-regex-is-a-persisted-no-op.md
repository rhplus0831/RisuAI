# Global Regex is a persisted no-op

## Summary

The Global Regex settings page edits and durably persists the `globalscript` collection, but neither supported regex execution path reads that collection. Browser-side display processing and Fastify-side prompt/generation processing both run the active prompt preset's `presetRegex`, character scripts, and module scripts only.

The editor therefore looks fully functional and its rows survive reload and synchronize across clients, while none of its **Modify Input**, **Modify Output**, **Modify Request Data**, **Modify Display**, or **Modify Translation Display** rules affect a chat.

## Location

- `src/lib/Setting/Pages/GlobalRegex.svelte:16-28,34-60`
- `src/ts/server/scriptDefinitionBridge.svelte.ts:685-694,1119,1339-1379,2081-2084`
- `src/ts/server/commands.ts:4319-4345`
- `server/fastify/src/routes/commands.ts:1986-2029`
- `src/ts/process/scripts.ts:322-363`
- `src/lib/ChatScreens/ChatBodyParseMemo.ts:382-455`
- `src/lib/SideBars/Scripts/RegexData.svelte:150`
- `src/ts/translator/translator.ts:275-282,1358-1378`
- `server/fastify/src/prompt/scripts.ts:23-31,575-609`

## Trigger

1. Open **Settings -> Global Regex**.
2. Add a rule with an unmistakable match and replacement, such as an `editdisplay` rule that replaces a word already present in the active transcript or an `edittrans` rule that replaces translated text.
3. Return to the chat, translate or display matching text, send matching input, or generate matching output.
4. Reload the app or open it in another browser to confirm that the rule itself was saved.

The row remains present after reload, but it does not transform input, request data, output, or displayed text.

## Expected behavior

Rules in a page named Global Regex, whose editor exposes five executable regex modes, should participate in regex processing for every applicable character/chat. A successfully saved rule should affect subsequent generation stages, translation post-processing, and mounted message rendering according to its selected type.

## Actual behavior

The `globalscript` value is updated optimistically, accepted by Fastify, written to SQLite settings, acknowledged, and returned by later settings reads. Runtime processing ignores it:

- browser `processScriptFull()` builds its script list from the active prompt preset regex, `char.customscript`, and active module regex;
- browser translation post-processing builds its `edittrans` list from module and character scripts only;
- the chat-body parse memo does not include `globalscript` in its dependency signature; and
- Fastify prompt processing builds the same three-source list and does not include `database.globalscript`.

As a result, persistence and synchronization work while the advertised behavior is a complete no-op.

## Underlying cause

The persisted editor field and the runtime field diverged. `GlobalRegex.svelte` owns `Database.globalscript`, while the main browser and Fastify execution implementations now treat `Database.presetRegex` (or the selected prompt preset's regex projection) as the only database-level regex source. The separate translation-display implementation omits both database-level sources and executes only module and character `edittrans` rows.

The mutation plumbing reinforces the false success signal: the script-definition watcher detects `globalscript` changes, chooses either a sparse definition mutation or an absolute advanced-settings patch, and Fastify deliberately validates and writes that exact field. Nothing in the acknowledgement indicates that the saved collection has no consumer.

This is not merely a stale render cache. Even a fresh reload and a new server-side generation omit the rules because neither execution list contains `globalscript`.

## Affected data flow

1. **UI interaction:** `GlobalRegex.svelte` binds `RegexList` to a server-backed draft for `globalscript`. Adding, importing, editing, deleting, or reordering a row changes that draft.
2. **Client projection:** `createServerBackedSettingDraft(..., { dispatch: false })` writes the new collection into the advanced-settings projection. `watchServerBackedScriptDefinitions()` snapshots the global-script owner and detects the change.
3. **Request:** the bridge stages a durable owner-scoped mutation and sends either `PATCH /api/v1/commands/settings/advanced/global-scripts` for the sparse operation or `PATCH /api/v1/commands/settings/advanced` with `patch.globalscript` for an absolute replacement.
4. **Server persistence:** the targeted route applies the collection mutation, validates referenced assets, calls `writeSettingsOnly()`, emits `settings.updated` for the `advanced` group, and returns the digest/certificate acknowledgement. The absolute settings route likewise writes the field.
5. **Acknowledgement/UI state:** the verified local effect advances the settings projection, or normal invalidation rereads the advanced group. The editor consequently displays the accepted collection and reloads it later, correctly implying that the data was saved.
6. **Browser display processing:** `processScriptFull()` executes `getActivePromptPresetRegexScripts(db)`, character scripts, and module scripts. `globalscript` is absent, and the chat-body parse key also has no `globalscript` dependency.
7. **Browser translation display:** `applyEdittransRegex()` concatenates module and character scripts only. It omits the persisted global rows (and prompt-preset rows), so an accepted global `edittrans` rule cannot modify translated text.
8. **Fastify generation processing:** `getPreparedScripts()` concatenates `db.presetRegex`, `char.customscript`, and active-module regex. The persisted global rows are absent from input, request-data, and output processing as well.

## Severity and user impact

**High.** An entire advanced editing surface reports durable success while providing none of its advertised behavior. Users can rely on global rules for prompt cleanup, output transformations, display/translation formatting, or safety-related filtering and have every rule silently ignored. Because the data survives reload and synchronizes normally, the UI gives no indication that the problem is execution rather than configuration, making diagnosis especially difficult.

## Recommended fix

Define one explicit ownership contract for global and prompt-preset regex, then use it in both execution implementations. If Global Regex is intended to apply in addition to the selected prompt preset, build the ordered script list from:

1. `globalscript`;
2. the effective prompt preset's regex;
3. character scripts; and
4. active module scripts.

Apply the same ordering and override semantics in `src/ts/process/scripts.ts` and `server/fastify/src/prompt/scripts.ts`. Define the corresponding ordering for `edittrans` in `translator.ts` and include the global collection there. Add `globalscript` to the browser parse-memo dependency signature and to the server prepared-script memo identity so an authoritative advanced-settings update invalidates already rendered messages and cached prepared scripts. The translator's cache signature already mentions `globalscript`; its actual execution list must match that signature.

If `globalscript` is intentionally retired, remove the Global Regex page and migrate or clearly redirect existing rows into an active prompt-preset owner instead of continuing to accept inert data.

Add end-to-end tests for all five rule modes. Each test should edit a Global Regex row through the UI-facing bridge, assert the SQLite-backed settings read contains it, and then assert that the applicable browser display/translation path or Fastify generation path uses the accepted rule. Include a foreign `settings.updated` case to verify that a mounted transcript reparses after another client changes the collection.
