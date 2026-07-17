# Remote-saving setting is a persisted no-op

## Summary

Advanced Settings still exposes **Enable Remote Saving** and durably persists `enableRemoteSaving`, but the Fastify application has no reachable save/export path that reads it. Its sole behavioral reader is inside the unused `RisuSaveEncoder` compatibility class. The pre-Fastify application instantiated that encoder from its save pipeline; the current application does not instantiate it anywhere.

Enabling the checkbox therefore updates every settings projection and survives reload while changing no save, backup, export, or synchronization behavior.

## Location

- `src/ts/setting/advancedSettingsData.ts:383-405`
- `src/lib/Setting/SettingRenderer.svelte:20-40`
- `src/lib/Setting/Wrappers/SettingCheck.svelte:15-31`
- `src/ts/setting/utils.ts:137-190,262-267`
- `src/ts/server/settingsGroups.ts:115`
- `src/ts/server/settingsBridge.svelte.ts:451-609`
- `server/fastify/src/routes/commands.ts:1360,1458,1844-1907`
- `src/ts/storage/risuSave.ts:15-22,118-196,198-242,334-395,398-535`

## Trigger

1. Open **Advanced Settings**.
2. Enable **Remote Saving**.
3. Wait for the settings mutation to settle and reload the application.
4. Exercise the available server/local backup, character export, or save workflows.

The checkbox remains enabled after reload, but the same supported save paths run and produce the same artifacts as when it is disabled. No background remote-save activity is started and no supported restore path consumes remote blocks.

## Expected behavior

An enabled persisted setting named Remote Saving should activate a corresponding save/synchronization path, or at minimum be unavailable with an explanation when the current architecture does not support it. Its checked state should describe actual runtime behavior rather than an inert database flag.

## Actual behavior

The UI and Fastify correctly save `enableRemoteSaving`. Nothing reachable after that acknowledgement reads the value. Repository-wide production usage consists only of `disableRemoteSaving()` in `src/ts/storage/risuSave.ts`, and that helper is called only by `RisuSaveEncoder.encodeBlock()`. No current production module creates a `RisuSaveEncoder` or calls its encoder methods.

The active Fastify backup/export implementations use the server snapshot, bundle, and local-backup encoders, so toggling the field has no effect. The compatibility decoder also explicitly skips remote blocks in server-backed mode, which means simply reconnecting the old encoder would not provide a valid round trip.

## Underlying cause

The migration removed the frontend-owned RisuSave/remote-block save pipeline but retained all of the following:

- the schema-driven checkbox;
- the settings-group ownership entry;
- Fastify validation and persistence for the field; and
- the dormant compatibility encoder that documents the former behavior.

The old application instantiated `RisuSaveEncoder` from its global save pipeline. The current Fastify application moved backup and import responsibilities to dedicated server-owned paths and no longer has that call graph, but the UI was not retired or redirected.

## Affected data flow

1. **UI interaction:** `SettingCheck` changes the schema row whose `bindKey` is `enableRemoteSaving`.
2. **Client projection:** `setSettingValue()` writes the boolean into the trusted settings projection. The checkbox's synchronization effect immediately displays the new value.
3. **Request:** the settings bridge stages a durable settings intent and sends the advanced-group patch through the normal Fastify settings command path.
4. **Server persistence:** Fastify accepts `enableRemoteSaving` as an advanced setting, writes the settings row in SQLite, bumps the revision, emits `settings.updated`, and returns the normal acknowledgement.
5. **Displayed state:** a verified local effect or authoritative advanced-group read leaves the checkbox checked. Other clients receive the same checked value through invalidation.
6. **Runtime behavior:** no mounted component, backup helper, export helper, bootstrap task, or server operation reads the flag. The only reader is the uninstantiated `RisuSaveEncoder` compatibility path, so the data flow stops after acknowledgement.

## Severity and user impact

**Low-medium.** The setting is a complete behavioral no-op and falsely presents an unavailable storage mode as enabled. Users can form incorrect expectations about how compatible saves or exports are split and restored, while persistence across reloads makes the option appear configured correctly. The former implementation used remote blocks as part of its primary browser-storage encoding path rather than as a separate synchronization or protection guarantee, and normal Fastify SQLite persistence is unaffected.

## Recommended fix

Remove or hide the setting in the Fastify build until there is a supported server-owned remote-save design. Existing persisted values should be ignored explicitly and, if useful, surfaced with a one-time migration notice explaining that the feature is unavailable.

If remote saving is to be restored, define it as a Fastify-owned operation rather than reactivating the dormant browser encoder in isolation. The implementation needs:

- an authenticated, active-writer server API with clear storage ownership;
- explicit progress, failure, and retry state in the UI;
- a self-contained export or a supported server-side remote-block restore path;
- revision/lineage behavior for destructive restores; and
- end-to-end tests proving that enable, save, reload, and restore round-trip the same data.

Add a reachability/parity test for every persisted settings row whose purpose is operational: either the field must have a live consumer, or the UI registry must intentionally omit it for the Fastify runtime.
