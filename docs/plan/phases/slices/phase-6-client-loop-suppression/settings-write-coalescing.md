# Settings Write Coalescing

Status: planned.

## Source Anchors

- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/commands.ts`
- Settings UI components that call immediate patch helpers.

## Scope

Debounce high-frequency settings inputs and skip equality-noop writes so
interactive controls do not emit command-per-drag updates.

## Protocol Behavior

- Prefer the queued settings watcher path for interactive controls.
- Add equality checks before immediate server-backed settings patches.
- Preserve rollback and conflict handling.

## Done When

- Color or slider-like inputs coalesce command writes.
- NanoGPT or dashboard-style read persistence avoids no-op commands.
- Tests prove unchanged final setting value with fewer command sends.

## Validation

- Focused settings bridge tests.
- `pnpm test -- src/ts/server`
