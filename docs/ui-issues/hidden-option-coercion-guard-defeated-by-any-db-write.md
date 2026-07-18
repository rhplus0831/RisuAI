# Hidden-option coercion guard is defeated by any database write

## Summary

The mount-time fix for `settings-conditional-options-persist-hidden-fallback`
protects a persisted-but-currently-hidden select value only until the first
unrelated database write. The coercion effect in the select/segmented wrappers
re-runs whenever its `processedOptions` dependency gets a new identity, and that
identity churns with the global resource-database facade epoch — which is bumped
by every write to any resource. After the first bump, the one-shot guard is
already spent and the hidden value is rewritten and persisted.

This was proven with a mounted-component probe: a content-identical `ctx` swap
after mount coerced a hidden persisted value and dispatched a real
`setSettingValue` write in both wrappers.

## Location

- `src/lib/Setting/Wrappers/SettingSelect.svelte:60-85` — one-shot
  `hasObservedInitialOptions` guard plus the coercion `$effect` keyed on
  `processedOptions`.
- `src/lib/Setting/Wrappers/SettingSegmented.svelte:42-62` — same pattern.
- `src/lib/Setting/SettingRenderer.svelte:21-30` — `ctx` is `$derived` and reads
  `getDatabase()`.
- `src/ts/server/resourceState.svelte.ts:2669-2675` — `getResourceDatabase`
  tracks `resourceDatabaseFacadeEpoch`, which is bumped by every database write
  anywhere in the app.

## Trigger

1. The database holds a select/segmented value that is configured but currently
   hidden by an option-level `condition` — e.g. `thinkingType: 'adaptive'`
   while the selected model exposes only `claudeThinking`, or
   `translator: 'zh-TW'` while `translatorType` is `deepl`. Such states are
   created by another device, an older/newer client build, or past model
   switches.
2. Open the settings page containing the control. Mount correctly preserves the
   value (the prior fix works once).
3. Perform any unrelated database mutation: toggle any checkbox on the page,
   receive any SSE-applied refresh, or let any chat write land.

## Expected behavior

The persisted hidden value stays untouched until the option set semantically
changes or the user actively picks an option.

## Actual behavior

The unrelated write bumps the facade epoch, `ctx` recomputes to a new object,
`processedOptions` recomputes to a new array, and the coercion effect re-runs
with `hasObservedInitialOptions` already `true`. The hidden value is rewritten
to `selectFallbackValue` (or the last visible option) and persisted through a
real settings PATCH.

## Underlying cause

The guard is a one-shot boolean, but the effect's dependency has churn-prone
identity by design (`getResourceDatabase()` tracks a coarse global epoch). The
guard therefore survives exactly one epoch bump instead of distinguishing
"option set actually changed" from "same options, new array identity".

## Affected data flow

1. Any UI write or SSE apply → `markResourceDatabaseChanged()` → facade epoch
   `$state` bump.
2. `SettingRenderer.ctx` `$derived` rebuild → `processedOptions` fresh array.
3. Coercion `$effect` re-runs; hidden value fails the membership test.
4. `localValue` is rewritten; the write-back effect calls `setSettingValue`.
5. `PATCH /api/v1/commands/settings/<group>` persists the coerced value; other
   clients receive it via invalidation.

## Severity and likely user impact

**High.** Confidence: high (probe-proven). Settings the user never touched are
silently rewritten and persisted; the coercion can disable features (e.g.
`translator` coerced to `''`) and can ping-pong between clients whose builds
expose different model capabilities.

## Recommended fix

In both wrappers, track the previous semantic option set (for example
`JSON.stringify(availableOptions.map((o) => o.value))`) and run coercion only
when that string actually changed; keep the existing mount skip for the first
observed set.

## Test gap

Add a wrapper test that mounts with a hidden persisted value, then swaps in a
content-identical `ctx` (new object identity) and asserts no `setSettingValue`
dispatch; follow with a genuinely changed option set and assert coercion then
runs once.
