# Select fallback rewrites an unavailable value on first render

## Summary

`SettingSelect` intends to preserve an unknown or conditionally unavailable
persisted value on first render, but its separate database-to-local effect
applies `selectFallbackValue` before that first-render guard runs. The normal
local-to-database effect then treats the display fallback as a user edit and
persists it.

The concrete live case is translator language. `zh-TW` and `fa` are shown only
for the Google translator, and the control configures Disabled (`""`) as its
fallback. Loading Language Settings with one of those saved targets while a
non-Google translator is selected silently disables translation.

Post-mount replacement when an option set deliberately changes is separate,
explicit behavior in the current wrappers and UI inventory. This report is
limited to the first-render path that bypasses the wrappers' own preservation
guard.

## Location

- `src/lib/Setting/Wrappers/SettingSelect.svelte:20-36` filters conditional
  options and applies the configured fallback during database-to-local sync.
- `src/lib/Setting/Wrappers/SettingSelect.svelte:38-47` writes a changed local
  value through `setSettingValue()`.
- `src/lib/Setting/Wrappers/SettingSelect.svelte:49-59` explicitly tries not to
  coerce unavailable persisted values on the first option observation, but does
  not guard the earlier sync effect.
- `src/ts/setting/languageSettingsData.svelte.ts:94-125` makes `zh-TW` and `fa`
  Google-only and configures `selectFallbackValue: ""`.
- `src/ts/setting/utils.ts:193-224` applies the fallback optimistically and
  dispatches it to the settings bridge.
- `src/ts/server/settingsGroups.ts:314` maps `translator` to the `language`
  settings group.
- `server/fastify/src/routes/commands.ts:2008-2071` validates, persists, and
  acknowledges the language settings PATCH.

## Trigger

1. Have a persisted/imported state with `translator = "zh-TW"` or `"fa"` and
   `translatorType` set to a non-Google provider. This can be produced by an
   older/newer client, import, remote edit, or another code path that changes the
   provider independently.
2. Open Language Settings so the translator-language `SettingSelect` mounts.
3. Do not interact with the translator-language control.

## Expected behavior

The first-render behavior should match the explicit comment and guard in
`SettingSelect`: a persisted value from another client or a temporarily hidden
option should remain stored. The select may render an unavailable/unsupported
sentinel, blank selection, or warning, but opening the page must not mutate data.

## Actual behavior

The database-to-local effect computes the visible options, does not find
`zh-TW`/`fa`, and assigns the configured empty fallback to `localValue`. The
write-back effect sees that `"" !== getSettingValue(...)` and calls
`setSettingValue()`. The client and Fastify then durably store Disabled even
though the user made no selection.

Returning to Google does not restore the target because the fallback is now the
authoritative persisted value.

## Underlying cause

There are two independent coercion paths in the component. The option-change
effect has `hasObservedInitialOptions` and skips its first run. The earlier
database-to-local effect has no equivalent guard and calls
`resolveConfiguredFallback(getSettingValue(...), processedOptions)` on mount.

Both paths assign the same writable `localValue` that user input uses. The
write-back effect has no provenance flag to distinguish a render fallback from a
user selection, so the first sync assignment becomes a durable mutation before
the preservation guard can help.

## Affected data flow

1. **UI mount:** Language Settings renders `SettingSelect` for
   `lang.translatorLang`.
2. **Option projection:** With a non-Google `translatorType`, `processedOptions`
   excludes the persisted `zh-TW` or `fa` value.
3. **Client state:** The database-to-local effect resolves the configured
   fallback and assigns `localValue = ""`.
4. **Optimistic projection:** The write-back effect calls `setSettingValue()`,
   which changes `getDatabase().translator` to the empty value.
5. **Request:** The deferred settings writer sends
   `PATCH /api/v1/commands/settings/language` with `{ translator: "" }`.
6. **Server persistence:** Fastify applies the settings patch and calls
   `writeSettingsOnly()`, committing Disabled to SQLite.
7. **Acknowledgement/display:** The settings event/resource acknowledgement now
   confirms the fallback, so every consumer displays Disabled and reload cannot
   recover the prior target.

## Severity and likely user impact

**Medium.** This is silent, requires no interaction, and permanently loses a
provider-specific translation preference. Its current live scope is narrow, but
the generic wrapper makes any future conditional select with an explicit
fallback vulnerable to the same mount-time write.

## Recommended fix

Keep the durable value separate from the render fallback:

1. Do not call `resolveConfiguredFallback()` from the database-to-local effect
   for a defined persisted value.
2. Render an unavailable/current-value sentinel or a display-only fallback while
   leaving `localValue` equal to the durable value.
3. Persist the configured fallback only from an explicit select change event (or
   an explicit versioned migration), not from a component effect.
4. If local state must be normalized for the underlying HTML select, add a
   suppression/provenance flag so that assignment cannot reach
   `setSettingValue()`.

## Test gap

The existing select tests cover an unavailable value without a configured
fallback and invalid/missing translator values with a fallback. Add the missing
combination: mount the real translator-language item with `currentValue =
"zh-TW"` and a non-Google context, then assert `setSettingValue()` is not called
and the persisted value remains `zh-TW`. Add the same case for `fa` and an
integration assertion that mounting the page sends no language settings PATCH.
