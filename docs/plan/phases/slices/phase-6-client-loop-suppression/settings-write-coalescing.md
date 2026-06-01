# Settings Write Coalescing

Status: partially implemented; debounce/coalescing exists, equality-noop and
coverage gaps remain.

## Source Anchors

- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/commands.ts`
- Settings UI components that call immediate patch helpers.

## Scope

Keep high-frequency settings inputs from emitting command-per-drag updates and
close remaining no-op write gaps.

Current behavior: `watchServerBackedSettings()` and
`createServerBackedSettingDraft()` queue settings patches with a short debounce.
`applyServerBackedSettingsPatch()` still sends immediate patches and does not
skip values that are already equal to the projection.

## Protocol Behavior

- Prefer the queued settings watcher path for interactive controls.
- Add equality checks before immediate server-backed settings patches.
- Preserve rollback and conflict handling.

## Done When

- Debounced settings flows keep coalescing command writes.
- Immediate patch helpers skip equality no-ops.
- Tests prove unchanged final setting value with fewer command sends.

## Validation

- Focused settings bridge tests.
- `pnpm test -- src/ts/server`
