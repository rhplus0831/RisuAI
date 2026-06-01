# Phase 6: Client Loop Suppression

Status: partly implemented; settings write coalescing is implemented, while
memory job SSE refresh and watcher echo coverage remain planned.

Goal: prevent server-origin refreshes, polling loops, and high-frequency UI
controls from echoing into repeated commands or overlapping requests.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
- `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte`
- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/chatBridge.svelte.ts`
- `src/ts/server/lorebookBridge.svelte.ts`
- `src/ts/server/scriptDefinitionBridge.svelte.ts`
- `src/ts/storage/database.svelte.ts`

## Slices

- [`memory-jobs-sse-driven-refresh.md`](slices/phase-6-client-loop-suppression/memory-jobs-sse-driven-refresh.md)
- [`projection-apply-suppression-token.md`](slices/phase-6-client-loop-suppression/projection-apply-suppression-token.md)
- [`settings-write-coalescing.md`](slices/phase-6-client-loop-suppression/settings-write-coalescing.md) -
  implemented; immediate settings patches skip equality no-ops, debounced
  watcher patches still coalesce, and queued patches are dropped when the final
  value returns to the original baseline.
- [`watcher-baseline-tests.md`](slices/phase-6-client-loop-suppression/watcher-baseline-tests.md)

## Exit Criteria

- Memory job UI avoids overlapping list requests and relies on SSE where
  possible.
- Server projection application cannot be mistaken for a local edit by bridge
  watchers.
- High-frequency settings controls continue to coalesce and skip equality-noop
  writes.
- Watcher behavior has tests for server-origin refreshes.

## Validation

- `pnpm test -- src/ts/server`
- Focused component or bridge tests for changed watchers.
