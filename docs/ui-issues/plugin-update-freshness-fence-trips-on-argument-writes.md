# Plugin update/import freshness fence trips on unrelated argument writes

## Summary

Plugin update installs and imports are fenced by a JSON snapshot of the entire
`db.plugins` array. Argument values (`realArg`) are part of that snapshot, so
any argument write anywhere — the user typing in another plugin's setting, or
a running V3 plugin calling `setArg` — invalidates an in-flight install. The
install then reports "install failed" (or a user-confirmed duplicate import
silently does nothing), even though nothing about the update target changed.

## Location

- `src/ts/server/pluginImport.ts:53-59` — `capturePluginImportTarget`
  snapshots `JSON.stringify` of the whole plugin list.
- `src/ts/server/pluginImport.ts:72-78` — `isFreshPluginImport` compares that
  snapshot verbatim.
- `src/ts/plugins/plugins.svelte.ts:120-153` — `installPluginUpdate` returns
  `'stale'` when the fence trips (`:130-131`, `:139-141`).
- `src/lib/Setting/Pages/PluginSettings.svelte:209-233` —
  `handlePluginUpdateAction` maps `'stale'` to the `'install-failed'` status
  whenever the row identity still matches (`:228-229`).
- `src/ts/plugins/plugins.svelte.ts:470-478,491-493` — the duplicate-import
  confirm and the post-confirm re-resolution return silent `false` on the same
  fence.
- `src/ts/plugins/apiV3/v3.svelte.ts:1254-1274` — a running plugin's
  `setArgument` rewrites a plugin row at any time.
- `src/ts/pluginCommands.ts:569-593` — argument edits replace the row per
  keystroke.
- `src/ts/plugins/plugins.svelte.ts:569-584` — `pluginRuntimeSignature`'s doc
  comment states argument values are intentionally excluded from runtime
  identity, for exactly this reason.

## Trigger

1. A plugin with `updateURL` shows "update available"; click install and
   confirm.
2. While the update-source permission prompt is open or the download is in
   flight, either type one character in any plugin's argument field on the
   same settings page, or have any running V3 plugin call `setArgument`.

## Expected behavior

The install proceeds: argument-value writes do not change the identity of the
plugin being updated (`isCurrentPluginUpdateTarget` already pins
name/script/updateURL).

## Actual behavior

`isFreshPluginImport` fails, `installPluginUpdate` returns `'stale'`, and the
row shows the "install failed" status. With a chatty plugin writing arguments
periodically, installs can fail persistently. The same fence silently kills a
user-confirmed duplicate import (bare `false`, no message).

## Underlying cause

The anti-concurrent-import fence hashes presentation/argument state that the
runtime signature explicitly excludes; it should fence only identity-relevant
fields.

## Affected data flow

1. Install click → `beginPluginImport` snapshot → permission prompt +
   download (seconds).
2. Concurrent `realArg` optimistic write changes the plugins array.
3. Snapshot mismatch → `'stale'` → UI "install failed" / silent import abort.
4. Nothing persisted, no retry hint.

## Severity and likely user impact

**Medium.** User-visible spurious failure of an explicit action; realistic
setups (plugins persisting state via `setArg`) can make it persistent.

## Recommended fix

Snapshot only identity/runtime fields (name, script, updateURL,
versionOfPlugin, version, enabled, allowedIPC) in
`capturePluginImportTarget` — e.g. reuse `pluginRuntimeSignature` — or diff
per-plugin identity rather than the full-row JSON.

## Test gap

A test that begins a plugin import, mutates another plugin's `realArg`, and
asserts `isFreshPluginImport` still passes (and the install completes).
