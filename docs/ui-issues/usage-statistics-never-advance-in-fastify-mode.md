# Usage statistics never advance in Fastify mode

## Summary

The live **Show Statistics** dialog still displays `statics.messages` and `statics.imports`, but neither counter advances through the actions it purports to count in the Fastify application. The only remaining message increment is explicitly restricted to the non-server compatibility path, which the production application cannot enter, and the character-import increment was removed altogether during the migration.

Send, continue, reroll, generation-entry, and character-card import flows can persist their normal data successfully while the corresponding displayed count remains at its imported value or the default `0`. Reloading and cross-client synchronization preserve those stale counts because none of those operational requests updates them in SQLite. A whole-database import or restore can replace `statics` as part of the imported settings object, but subsequent usage still does not advance it.

## Location

- `src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte:101-113`
- `src/ts/process/sendChatContext.ts:134-182`
- `src/ts/server/commands.ts:1939-1941`
- `src/lib/ChatScreens/DefaultChatScreen.svelte:945-1000`
- `src/ts/characterCards.ts:78-346,623-1021`
- `src/ts/chatCommands.ts:4048-4209`
- `src/ts/process/index.svelte.ts:215-382`
- `server/fastify/src/routes/commands.ts:5824-5866`
- `server/fastify/src/routes/save.ts:88-128,479-511`
- `server/fastify/src/repository.ts:272-287`
- `server/fastify/src/databaseDefaults.ts:385-404`
- `src/ts/storage/database.svelte.ts:2984-2989,3785-3788`

The pre-migration behavior is visible at `/home/codex/Risuai/src/ts/process/index.svelte.ts:219`, where each accepted `sendChat` entry incremented `DBState.db.statics.messages`, and `/home/codex/Risuai/src/ts/characterCards.ts:58-81`, where non-JSON card import attempts incremented `DBState.db.statics.imports` before format validation. JSON imports returned through the earlier branch and were not counted; malformed non-JSON attempts could still be counted.

## Trigger

1. Open Advanced Settings and choose **Show Statistics**; note the `messages` and `imports` values.
2. Send one or more successful chat turns, use Continue/Reroll so that `sendChat()` runs, and/or successfully import a PNG/CharX character card.
3. Open **Show Statistics** again, then optionally reload the application or inspect it from another client.

## Expected behavior

The message statistic should advance according to the pre-migration generation-entry contract, or a clearly documented replacement contract, and the updated count should be durable. The import statistic needs an explicit corrected contract: preserving the old implementation exactly would count non-JSON attempts before validation while excluding JSON imports, whereas a more useful definition would count successful character creations consistently across formats. A reload or another client should display whichever authoritative counts the product defines.

If statistics are intentionally retired, the application should remove the live dialog rather than display a counter that can no longer change.

## Actual behavior

Chat messages, generated responses, imported character rows, and imported assets can all be written to SQLite normally, but neither counter changes in the browser or on the server as a consequence of those actions. **Show Statistics** continues to display the old values until a whole-database import/restore happens to replace them. Fresh databases therefore normally show `messages = 0` and `imports = 0` regardless of ordinary use.

## Underlying cause

`setupSendChatContext` computes `serverBacked = canUseServerCommands()` and increments the statistic only inside `if (writeMaintenance && !serverBacked)`. The Fastify-only runtime always has server commands enabled, so the increment at line 173 is unreachable in production.

The server-backed maintenance branch persists `lastInteraction` and legacy missing message IDs through character/message commands, but it has no statistics step. The user-message command and the server generation/finalization paths likewise mutate messages, chats, and generation state without changing `statics`.

The current `importCharacterProcess` and `importCharacterCardSpec` paths create characters and stage/import assets through revisioned server operations but contain no equivalent of the old `statics.imports += 1`. A repository-wide production search finds no action-specific writer for the imports field. The old writer was also not a clean successful-import metric: its JSON branch returned before the increment, while eligible non-JSON files incremented before validation completed.

Although server defaults and the browser `Database` shape still retain `statics`, `statics` is not assigned to a writable settings group and there is no dedicated statistics command. Consequently there is no send/import request, event, acknowledgement, or targeted resource update capable of advancing the value. A destructive database import/restore can replace the settings row—including an imported `statics` object—and a full refresh can project that replacement, but the settings resource otherwise keeps returning the old imported/default object.

## Affected data flow

1. **UI interaction:** the composer appends a user row through `appendCurrentChatUserMessageForSend` and invokes `sendChat` through `sendChatMain`; character drop/picker/Realm workflows enter `importCharacterProcess` or the server Realm importer.
2. **Client projection:** normal optimistic chat/message state changes are applied, but `setupSendChatContext` deliberately skips `getDatabase().statics.messages += 1` when `canUseServerCommands()` is true.
3. **Requests:** the browser sends message/generation operations or character/asset import operations. None of those payloads contains a statistics delta.
4. **Server persistence:** Fastify commits the message, generation-owned chat state, character, and asset rows; emits their normal events; and returns revisions/acknowledgements. It never updates the settings row containing `statics`.
5. **Synchronization:** subsequent settings reads after ordinary counted actions return the unchanged `statics` object. No statistics event exists to invalidate or replace it with a newer count; only a broad database replacement can incidentally replace the object.
6. **Displayed state:** `SettingsExportButtons.svelte` reads the stale object directly from `getDatabase()` and renders it as current statistics.

## Severity and user impact

**Low.** Chat persistence, generation, and imports still work, but the application presents authoritative-looking usage data that is systematically wrong for every Fastify user. Migrated users see frozen historical totals, while new users see zeros. This makes the dialog unusable for support diagnostics or personal usage tracking.

## Recommended fix

Choose one authoritative counting contract and implement it on the server. Add statistics increments to the server-owned generation and character-import transactions (or use dedicated idempotent revisioned commands) so retries, durable-job reattachment, and import replay cannot double count them. Counting successful imports across all supported formats would deliberately correct the legacy format/failure inconsistency; preserving attempt counts instead must define exactly which rejected inputs count. Emit a settings/statistics event and return an acknowledgement that updates the browser projection.

Define precisely whether the count represents generation attempts, successful generations, user-message appends, continues, or rerolls before placing the increment; the pre-migration implementation counted `sendChat` entries, including attempts that could later fail.

Alternatively, remove `Show Statistics`, `statics` defaults, and the compatibility field if the feature is no longer supported. Do not reintroduce a browser-only increment: it would diverge between tabs, disappear on authoritative refresh, and be vulnerable to the same persistence regression.

Add full-stack tests that perform each chosen counted action, verify the displayed values, reload resources, and verify the same values again. Cover JSON, PNG/CharX, malformed, and replayed imports so the format/failure contract is explicit. Include durable generation reattach/retry and idempotent import replay cases to prove that one logical action is counted exactly once.
