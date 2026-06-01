# Settings Write Coalescing

Status: implemented.

## Source Anchors

- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/commands.ts`
- Settings UI components that call immediate patch helpers.

## Scope

Keep high-frequency settings inputs from emitting command-per-drag updates and
close remaining no-op write gaps.

Current behavior: `watchServerBackedSettings()` and
`createServerBackedSettingDraft()` queue settings patches with a short debounce.
`applyServerBackedSettingsPatch()` skips values that are already equal to the
projection. Queued watcher patches keep the first baseline value and drop a key
when the final debounced value returns to that baseline.

## Protocol Behavior

- Prefer the queued settings watcher path for interactive controls.
- Add equality checks before immediate server-backed settings patches.
- Preserve rollback and conflict handling.

## Done When

- Debounced settings flows keep coalescing command writes. Done.
- Immediate patch helpers skip equality no-ops. Done.
- Tests prove unchanged final setting value with fewer command sends. Done.

## Validation

- `pnpm test -- src/ts/server/settingsBridge.svelte.test.ts`
- `pnpm test -- src/ts/server`
