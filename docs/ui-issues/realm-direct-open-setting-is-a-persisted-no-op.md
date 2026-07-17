# RisuRealm direct-open setting is a persisted no-op

## Summary

The Advanced Settings checkbox **Directly open character in RisuRealm** persists `realmDirectOpen`, but the preview-card interaction it used to control was removed from the current Main Menu. The current menu has only an **Open Risu Realm** button, and cards inside Realm always open their details regardless of the setting.

`RealmInitialOpenChar` still has a consumer in `RealmMain`, but no current component writes to it. Toggling the setting therefore changes stored data without changing any Realm navigation.

## Location

- Setting definition: `src/ts/setting/advancedSettingsData.ts:416-423`
- Setting group and generic request: `src/ts/server/settingsGroups.ts:258`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify persistence: `server/fastify/src/routes/commands.ts:1844-1907`
- Current Main Menu Realm entry: `src/lib/UI/MainMenu.svelte:11-26,29-75`
- Current Realm card and initial-target handling: `src/lib/UI/Realm/RealmMain.svelte:127-133,267-280`
- Orphaned target store: `src/ts/stores.svelte.ts:59`
- Former behavior for comparison: `/home/codex/Risuai/src/lib/UI/MainMenu.svelte:54-82`

## Trigger

1. Toggle **Directly open character in RisuRealm** on or off.
2. Return to the Main Menu and open RisuRealm.
3. Select a character card.

Both setting values produce the same navigation: the Main Menu first opens the Realm catalog, and selecting a card in that catalog opens its details.

## Expected behavior

As described by the setting's label and help text, enabling it should make a character clicked in the RisuRealm preview open directly in the detail view; disabling it should open the Realm catalog without preselecting that character.

## Actual behavior

There are no RisuRealm preview character cards on the current Main Menu. Its single button never reads `realmDirectOpen` and never assigns `RealmInitialOpenChar`. Within `RealmMain`, card clicks directly set `openedData` in both modes. The setting has no observable consumer.

## Underlying cause

The original Main Menu loaded a “Recently Uploaded” preview list. Its card callback opened Realm and conditionally wrote the clicked card to `RealmInitialOpenChar` when `realmDirectOpen` was true. The Fastify variant replaced that surface with one privacy-confirmed Realm button but retained the setting schema, translations, default, server allowlist, and store receiver.

The remaining `$RealmInitialOpenChar` effect can still open an initial detail if some code writes the store, but repository-wide production references contain no writer. Persistence therefore succeeds for an orphaned behavior flag.

## Affected data flow

1. **UI:** the Advanced Settings checkbox updates the shared settings projection.
2. **Request:** the generic setting lane sends `PATCH /api/v1/commands/settings/advanced` with `patch.realmDirectOpen`.
3. **Persistence/response:** Fastify validates, writes, emits `settings.updated`, and acknowledges the field; the checkbox remains synchronized across clients.
4. **Main Menu:** `openRealm()` checks only warning/confirmation state and sets `OpenRealmStore`; it never reads the accepted value or supplies a character.
5. **Realm UI:** catalog card callbacks always set local `openedData`. The initial-character store consumer remains idle because nothing writes it.

## Severity and user impact

**Low-medium.** No data is lost, but an advertised navigation preference cannot work. Because the value persists correctly, users can repeatedly toggle or reload while trying to understand why behavior is unchanged.

## Recommended fix

Choose one supported interaction contract:

- restore a Main Menu Realm preview and conditionally seed `RealmInitialOpenChar` by stable character ID after the external-server warning succeeds; or
- apply the option to a current, clearly defined Realm entry interaction; or
- remove the checkbox, translations, default, and stored setting if direct-open preview navigation was intentionally retired.

If restored, do not carry the full stale card object through an async confirmation. Capture its ID and resolve the latest catalog record before opening. Add mounted tests for enabled, disabled, cancelled warning, and a catalog refresh during confirmation.
