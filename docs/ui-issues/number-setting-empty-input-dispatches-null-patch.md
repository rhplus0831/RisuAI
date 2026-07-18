# Clearing a number setting dispatches a null patch and a spurious failure alert

## Summary

Clearing a schema-driven number field to retype it produces `null` (Svelte 5's
`bind:value` on `type="number"` yields `null` for an empty input), but the
wrapper's transient-input guard only checks for `undefined`. The `null` is
written into the projection and immediately dispatched as a settings PATCH,
which the server rejects, so a routine retype flow produces a "settings save
failed" alert and a snap-back that fights the user's editing. Proven with a
mounted-component probe: clearing the input called
`setSettingValue(item, null, ctx)`.

## Location

- `src/lib/Setting/Wrappers/SettingNumber.svelte:24-39` — write-back effect;
  the restore branch checks `val === undefined` only, so `null` falls through
  to `setSettingValue`.
- `src/lib/UI/GUI/NumberInput.svelte` — plain `bind:value`; Svelte's
  `to_number('')` returns `null`, so the `undefined` guard is dead code.
- `src/ts/setting/utils.ts:193-225` — `setSettingValue` applies the optimistic
  projection write and dispatches immediately (delay 0).
- `server/fastify/src/routes/commands.ts:9003-9005` — `null` fails number
  validation for keys in `NUMBER_SETTING_KEYS`.

## Trigger

Clear any number setting field to retype it (select-all + delete, or
backspacing through): `maxContext`, `loreBookDepth`, `chatDisplayTailCount`,
retries, and every other schema number row.

## Expected behavior

A transiently empty input is ignored — exactly what the `undefined` restore
branch was written to do — and the previous value returns on blur if nothing
is typed.

## Actual behavior

`null` is written into the projection (any consumer reading e.g. `maxContext`
mid-typing sees `null`), a `PATCH { key: null }` dispatches immediately, the
server rejects it with a validation error, and the user gets a spurious
"settings save failed" alert while the field snaps back — breaking the retype
flow.

Server-side note: `min_p` is absent from `NUMBER_SETTING_KEYS`, so a `null`
there would be accepted rather than rejected; its only current UI is a slider,
which cannot produce the empty state.

## Underlying cause

The guard predates Svelte 5's `null`-for-empty semantics; `null` is a transient
input state here, not a user intent.

## Affected data flow

1. Input cleared → `bind:value` → `localValue = null`.
2. Write-back effect: `undefined` guard misses → `setSettingValue(null)`.
3. Optimistic `null` projection + immediate PATCH.
4. Server 400 → rollback + `alertError`; field snaps back mid-typing.

## Severity and likely user impact

**Medium.** Confidence: high (probe-proven). A routine interaction produces a
false failure alert, a momentary invalid projection value visible to any
concurrent consumer, and a blocked field-clearing flow.

## Recommended fix

Treat `null` like `undefined` in the guard (`val === undefined || val === null`),
restoring `currentValue` without dispatching. Consider clamping to
`options.min`/`options.max` on commit, and add `min_p` to
`NUMBER_SETTING_KEYS` server-side.

## Test gap

A wrapper test that mounts a number row, sets the bound value to `null`, and
asserts no `setSettingValue` dispatch occurs and the displayed value is
restored.
