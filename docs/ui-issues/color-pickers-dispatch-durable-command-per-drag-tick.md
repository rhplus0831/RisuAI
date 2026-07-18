# Color pickers dispatch a durable settings command per drag tick

## Summary

`ColorInput` fires its `onchange` callback from an effect on every value
change, and the embedded color picker updates its bound hex on every pointer
move. The display color editors wire `onchange` straight to the immediate
settings-patch path, so a one-second drag stages 50–150 durable IndexedDB
outbox rows and dispatches as many `PATCH /settings/display` commands through
the global serialized command queue. Under a degraded server each tick raises
its own failure/queued reporter, producing alert storms and mid-drag rollback
flicker.

## Location

- `src/lib/UI/GUI/ColorInput.svelte:17-29` — `$effect` invokes `onchange` on
  every `value` change after initialization; there is no commit boundary.
- `node_modules/svelte-awesome-color-picker` `Picker.svelte:86-94` — hex
  updates per mousemove while dragging.
- `src/lib/Setting/Pages/Display/CustomColorSchemeEditor.svelte:28-34,55`,
  `src/lib/Setting/Pages/Display/CustomTextThemeEditor.svelte:16-22,33`,
  `src/lib/Setting/Pages/Display/NullableTextColorToggle.svelte:31-33` — wire
  `onchange` to the immediate `applyServerBackedSetting(s)Patch` path.
- `src/ts/server/settingsBridge.svelte.ts:655-665` — queue delay 0 plus
  synchronous flush, so each tick is its own durable command.

## Trigger

Display settings → custom color scheme, custom text theme, or
text-background color → drag inside a color picker for about a second.

## Expected behavior

Continuous input coalesces like the other continuous controls (the 250 ms
deferred-draft machinery), committing on release or debounce.

## Actual behavior

Every pointer-move tick stages a durable outbox row and dispatches a full
display-group PATCH. The serialized command queue backs up, delaying every
other pending mutation. On a degraded network each tick reports its own
failure/queued outcome — alert storms — and rollbacks interleave with new
ticks, flickering the color mid-drag. Final state converges, so there is no
durable data loss.

## Underlying cause

`ColorInput` turns a continuous input stream into per-tick commits, and the
display editors bypass the deferred-draft machinery for the immediate patch
path.

## Affected data flow

1. Drag → `bind:hex` → `ColorInput` effect → `onchange` per tick.
2. Editor handler → `applyServerBackedSettingsPatch` → optimistic write +
   queue(0) + synchronous flush.
3. Outbox row + `PATCH /api/v1/commands/settings/display` per tick →
   per-tick acknowledgement/failure reporting.

## Severity and likely user impact

**Medium.** Confidence: high. No data loss, but real queue backlog for all
other mutations, IndexedDB churn, and a broken failure-reporting experience on
flaky connections.

## Recommended fix

Fire `onchange` only on pointer-up/change (or debounce inside the `ColorInput`
effect), or route the display color editors through
`setDeferredSettingValue`/`createSettingInputDraft` like other continuous
inputs.

## Test gap

A component test that streams N rapid value changes through `ColorInput` and
asserts a single dispatched patch (after debounce/commit), not N.
