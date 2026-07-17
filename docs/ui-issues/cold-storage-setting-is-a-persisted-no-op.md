# Cold-storage setting is a persisted no-op

## Summary

The Advanced Settings page still exposes and durably persists the `coldstorage` checkbox, and its help text promises automatic archival of old chats and characters. Enabling it has no operational effect: the archival entry point returns immediately and is no longer invoked during bootstrap.

## Location

- `src/ts/setting/advancedSettingsData.ts:318-324`
- `src/lib/Setting/Wrappers/SettingCheck.svelte:15-38`
- `src/ts/setting/utils.ts:158-189`
- `src/ts/server/settingsGroups.ts:55-75`
- `src/lang/en.ts:416-417`
- `src/ts/process/coldstorage.svelte.ts:61-198`
- `src/ts/globalApi.svelte.ts:26`
- `server/fastify/src/routes/commands.ts:1844-1905`
- Pre-migration reference: `/home/codex/Risuai/src/ts/bootstrap.ts:242-255`

## Trigger

Open Advanced Settings and enable **Cold Storage**, then continue using or restart the app with characters and chats old enough to qualify for archival.

## Expected behavior

The setting described in the UI should schedule or run an archival process that moves eligible old data out of the hot database without losing it, updates the authoritative representation, and reports success or failure. If server-backed cold storage is intentionally unavailable, the control should be hidden or disabled and explain that limitation instead of accepting the value.

## Actual behavior

The checkbox changes immediately and survives reload, but no character or chat is archived. There is no archival request, server mutation, progress acknowledgement, storage-size change, or corresponding UI update.

## Underlying cause

The settings stack is functioning: `SettingCheck` calls `setSettingValue`, the client maps `coldstorage` to the `advanced` settings group, and `PATCH /api/v1/commands/settings/advanced` validates and persists the accepted key with a revisioned acknowledgement.

The consumer side was removed. `makeColdData()` unconditionally returns at `coldstorage.svelte.ts:196-198`, and the current frontend has no call site for it; `globalApi.svelte.ts` only leaves an unused import. The pre-migration bootstrap awaited `makeColdData()` before marking the app loaded. The remaining helper bodies therefore cannot run even if the stubbed storage methods were repaired.

## Affected data flow

1. **UI interaction:** The user toggles the Advanced Settings checkbox.
2. **Client state:** `SettingCheck` updates `localValue`; `setSettingValue` optimistically writes `getDatabase().coldstorage`.
3. **Request:** The deferred settings queue sends a patch for the `advanced` group containing `coldstorage: true`.
4. **Server persistence:** Fastify applies the settings patch and writes it to the settings table.
5. **Acknowledgement/projection:** The command revision is accepted, so the client continues to display the enabled value and restores it after reload.
6. **Missing consumer:** No bootstrap hook, scheduler, or server job evaluates old characters/chats. `makeColdData` would return without work even if called.
7. **Displayed result:** The UI communicates that the feature is active while the underlying data layout remains unchanged.

## Severity and user impact

**Medium.** This does not directly corrupt data, but it is a successful-looking control for a nonexistent feature. Users expecting reduced startup transfer, traffic, and memory usage receive none of the promised benefits and may spend time diagnosing why database growth continues. It is especially misleading alongside legacy archives that the same build cannot reopen.

## Recommended fix

Until a server-owned archival lifecycle exists, remove or disable the setting with a localized server-mode explanation and stop persisting a value that has no consumer.

For a full fix, implement a Fastify maintenance job with explicit eligibility rules, transactional SQLite/payload updates, verifiable archive storage, revisioned progress/results, and a recovery path. Trigger it from the accepted setting or a documented schedule. Do not re-enable the old client routine unchanged: archival is an authoritative destructive mutation and must not depend on one browser tab staying open.

## Test coverage gap

The current cold-storage tests only pin the disabled helper behavior. Add integration coverage that follows the setting from checkbox to `PATCH /settings/advanced`, then either asserts a visible unsupported state or runs the server job and verifies that eligible data is archived, recent data remains hot, failures preserve original rows, and archived content still opens after a fresh bootstrap.
