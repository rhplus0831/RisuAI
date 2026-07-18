# Plugin db-bridge undefined writes dangle unpersisted

## Summary

When a plugin writes `undefined` into an allowed settings key through the
V2.1/V3 db bridge, the value is applied to the live projection immediately —
the UI reacts (e.g. custom CSS clears) — but the settings patch dispatcher
silently drops `undefined` values, the promise resolves as success, and no
rollback entry exists. The visible change is never persisted and reverts on
the next settings refresh or reload.

## Location

- `src/ts/plugins/plugins.svelte.ts:889-892` — the bridge writes the raw
  value, including `undefined`, into the projection via
  `withTrustedResourceWrite` before any filtering.
- `src/ts/plugins/plugins.svelte.ts:920` — the key is added to the settings
  patch with its `undefined` value.
- `src/ts/pluginCommands.ts:1635-1653` — `dispatchPluginSettingsPatch` keeps
  only entries with `value !== undefined` (`:1637`), so the key never reaches
  the server; the rollback snapshot skips it the same way (`:1649-1652`).

## Trigger

A V2.1/V3 plugin executes `db.customCSS = undefined` (or
`setDatabaseLite({ theme: undefined })`) in server mode.

## Expected behavior

Either the write is rejected/warned (undefined is not a persistable settings
value), or the deletion is translated into a supported persisted form.

## Actual behavior

The projection field becomes `undefined` (UI reacts immediately), the patch
omits the key, the returned persistence promise resolves as success, and no
rollback exists — the UI change is never persisted (symptom class 1) while
success was reported (class 4). The old value reappears on the next
authoritative settings read.

## Underlying cause

The `value !== undefined` filter runs in the dispatcher, after the optimistic
projection write instead of before it.

## Affected data flow

1. Plugin proxy set → trusted projection write (`undefined`).
2. Patch built → key dropped → command resolves OK.
3. Later authoritative read restores the old value; UI reverts silently.

## Severity and likely user impact

**Low.** Requires a plugin to write `undefined` (medium confidence any do),
but the divergence window lasts until the next refresh and the reported
success is wrong.

## Recommended fix

Filter `undefined` values before the optimistic projection write in
`applyPluginDatabasePatch` (skip the key and `console.warn`), or translate to
an explicit supported deletion where one exists.

## Test gap

A bridge test writing `undefined` to an allowed key, asserting the projection
is not modified (or the write is reported unsupported).
