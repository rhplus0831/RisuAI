# Settings, Presets, Personas, And Translators Audit

Date: 2026-06-16

Status: bad

## Scope

Verified data-driven setting rows, manual settings bridge writes, prompt/model
presets, BotSettings prompt fields, personas, translator presets, and separate
parameter editors.

## Result

The tested command paths pass, but several input-driven update surfaces can
still lose or misapply edits.

## Findings

- `src/ts/server/settingsBridge.svelte.ts:107`, `:211`, and `:223` allow an
  immediate settings patch while an older debounced patch for the same key can
  still dispatch later.
- `src/lib/Setting/Wrappers/SettingNumber.svelte:23` writes local state before
  persistence, while `src/ts/setting/utils.ts:198` skips `undefined` server
  patches. Clearing a number input can become local-only until resync.
- `src/lib/Setting/Pages/BotSettings.svelte:453` queues prompt-field patches,
  but `:556` clears the timer on destroy instead of flushing.
- `src/lib/Setting/Pages/PersonaSettings.svelte:90` does not flush
  `flushPendingSelectedPersonaUpdate()` on destroy.
- `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:238` exposes
  flush helpers but has no destroy flush for pending prompt/name/max-response
  edits.
- `src/lib/Setting/Pages/SeparateParametersSection.svelte:68` iterates
  `Object.keys(seperateParametersDraft.value)`, so it can render `overrides` as
  a parameter row even though `src/lib/Others/AllSeperateParameters.svelte:13`
  expects a single `SeparateParameters` object.
- Prompt preset regex aliasing is mixed: runtime resolution is covered, but
  `src/lib/Setting/Pages/BotSettings.svelte:495` can render
  `{ regex: [...], presetRegex: [] }` as empty.

Normal sub-result: duplicate DisplaySettings watcher keys are deduped by
`new Set(...)` in `src/ts/server/settingsBridge.svelte.ts:177`.

## Verification

Targeted suites passed:

- `pnpm exec vitest run src/ts/server/settingsBridge.svelte.test.ts src/ts/persona.test.ts src/ts/presetSplit.test.ts src/ts/storage/database.svelte.test.ts src/ts/translator/presets.test.ts`
- Main broader settings run: 8 files, 108 tests passed.

Passing tests cover many command paths but not the destroy/queued-patch and
separate-parameter rendering hazards above.

## Follow-Up

Cancel or merge pending debounced settings patches when immediate patches are
sent, reject or restore undefined number edits, flush pending prompt/persona/
translator edits on destroy, and exclude `overrides` from the base separate
parameter row renderer.
