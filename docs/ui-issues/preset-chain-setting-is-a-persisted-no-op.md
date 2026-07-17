# Preset Chain is a persisted no-op in Fastify mode

## Summary

The Advanced Settings **Preset Chain** field still promises to select and apply one of the comma-separated presets at random whenever the user sends a message. The text is optimistically projected, written to SQLite through the `advanced` settings command, acknowledged, and restored after reload.

Normal sends never consume it. The only preset-chain selection block is explicitly guarded by `!serverBacked`, while the production runtime has server commands enabled. Fastify assembles the request from the chat's existing `generationSettings` and has no `presetChain` reader or equivalent random-selection step. A valid chain, an invalid chain, and a blank chain therefore produce the same generation behavior.

## Location

- Setting definition and promise: `src/ts/setting/advancedSettingsData.ts:66-73`; `src/lang/en.ts:336-337`
- Generic optimistic write and durable dispatch: `src/ts/setting/utils.ts:158-189,450-493`
- Settings group: `src/ts/server/settingsGroups.ts:252`
- Fastify validation, persistence, and acknowledgement: `server/fastify/src/routes/commands.ts:1335-1350,1844-1907`
- Skipped runtime consumer: `src/ts/process/sendChatContext.ts:146-170`
- Call from every top-level send: `src/ts/process/index.svelte.ts:210-225`
- Server-owned send request: `src/ts/process/serverBackedSendChat.ts:300-316`; `src/ts/process/request/serverChat.ts:47,232-270`
- Fastify chat route and prompt assembly: `server/fastify/src/routes/generationChat.ts:3208-3269`; `server/fastify/src/prompt/assemble.ts:624,648-649`
- Test that pins the disabled server-backed behavior: `src/ts/process/__tests__/sendChatContext.test.ts:181-203`
- Pre-migration behavior: `/home/codex/Risuai/src/ts/process/index.svelte.ts:189-203`

## Trigger

1. Put two existing preset names in **Preset Chain**, for example `Creative, Precise`.
2. Send several new top-level messages from a chat using Fastify.
3. Observe the active chat generation settings, selected preset, and assembled prompt/model configuration.
4. Optionally enter a nonexistent preset name and send again.

No listed preset is randomly applied. A nonexistent name also produces no `Cannot find preset` toast because even the validation-by-lookup block is unreachable.

## Expected behavior

For each new user send, one listed preset should be selected and applied before prompt assembly, as the field's help text states. Invalid entries should surface a clear error rather than silently generating with an unrelated preset.

In the migrated split-preset architecture, the selection should be scoped to the generation or chat and expressed using stable model/prompt preset IDs; it should not have to mutate an unrelated global editor selection.

## Actual behavior

`setupSendChatContext` computes `serverBacked = canUseServerCommands()` and enters the only `presetChain` branch only when `!serverBacked`. In the Fastify-only runtime the branch never splits the list, never calls `changeToPreset`, and never reports missing entries.

The browser then posts only the chat/character/mode intent to `/api/v1/generate/chat`. Fastify resolves `modelPresetId` and `promptPresetId` from the chat's already-persisted `generationSettings`; it never consults `presetChain`. Enabled and disabled therefore send the same effective preset configuration.

## Underlying cause

The pre-migration frontend changed the global legacy preset immediately before local prompt assembly. During the migration, prompt/model preset ownership moved to Fastify and to per-chat `generationSettings`. The legacy global-selection side effect was deliberately disabled for server-backed sends, but no server-owned replacement was implemented and the setting was not removed.

The existing unit test now codifies the gap: it asserts that a matching chain entry does not change `botPresetsId` in server-backed mode. Avoiding that global mutation is sensible, but it is not equivalent to providing the documented per-send chain behavior.

## Affected data flow

1. **UI interaction:** the Advanced Settings text input edits the `presetChain` projection.
2. **Client state and request:** the generic setting draft updates `database.presetChain`, stages a durable mutation, and sends `PATCH /api/v1/commands/settings/advanced` with `{ presetChain }`.
3. **Server persistence:** Fastify accepts the allowlisted string, writes settings to SQLite, emits `settings.updated`, and returns `acknowledgedKeys`.
4. **Displayed state:** settings reconciliation retains the accepted text, so the field appears fully functional across reloads and clients.
5. **Send initiation:** `sendChat` calls `setupSendChatContext`, but its chain block is skipped because server commands are available.
6. **Generation request:** the client posts `/api/v1/generate/chat` without a chain choice. Fastify assembles from the chat's current stable preset IDs and never reads the stored chain.
7. **UI result:** the ordinary generated response is displayed with no warning that the requested preset randomization was ignored.

## Severity and user impact

**Medium.** Users who rely on preset rotation can repeatedly generate with the wrong model, prompt, sampling configuration, or provider while the saved field indicates the feature is enabled. This can materially change output and cost, and invalid configuration is silently hidden. The defect is not direct data loss, but the successful persistence/acknowledgement makes it especially difficult to diagnose.

## Recommended fix

Implement the choice where generation ownership now lives. At job acceptance, Fastify should resolve the chain against authoritative stable preset IDs, select one entry, and assemble that generation with the selected model/prompt preset pair. Define whether the choice is generation-scoped or also updates the chat's `generationSettings`; if it updates the chat, perform that mutation atomically with submission and emit the corresponding resource event.

Do not key the durable behavior only by mutable display names. Migrate stored legacy names to stable IDs (with an explicit ambiguity/missing-entry result), or replace the free-text field with a multi-select backed by preset IDs. Return the chosen IDs/name in generation metadata so the UI can show which preset was used and durable reattachment can reproduce the same choice.

Add integration coverage that sends repeatedly with a deterministic random source, verifies only listed presets reach prompt dispatch, covers missing/deleted/renamed entries, and proves reattachment does not re-roll an accepted job. If preset chains are intentionally retired, remove the field and migrate `presetChain` instead of continuing to acknowledge it.
