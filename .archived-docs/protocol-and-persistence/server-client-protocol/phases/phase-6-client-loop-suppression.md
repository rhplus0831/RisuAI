# Phase 6: Client Loop Suppression

Status: implemented.

Goal: prevent server-origin refreshes, polling loops, and high-frequency UI
controls from echoing into repeated commands or overlapping requests.

## Source Anchors

- [`../../../AUDIT.md`](../audits/fastify-side-effect-audit.md)
- `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte`
- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/chatBridge.svelte.ts`
- `src/ts/server/lorebookBridge.svelte.ts`
- `src/ts/server/scriptDefinitionBridge.svelte.ts`
- `src/ts/storage/database.svelte.ts`

## Slices

- [`memory-jobs-sse-driven-refresh.md`](slices/phase-6-client-loop-suppression/memory-jobs-sse-driven-refresh.md) -
  implemented; the modal subscribes to memory SSE events, prevents overlapping
  list requests, and polls only while pending/running jobs are present.
- [`projection-apply-suppression-token.md`](slices/phase-6-client-loop-suppression/projection-apply-suppression-token.md) -
  implemented; server projection applies advance a shared watcher epoch so
  command-backed watchers refresh their baselines.
- [`settings-write-coalescing.md`](slices/phase-6-client-loop-suppression/settings-write-coalescing.md) -
  implemented; immediate settings patches skip equality no-ops, debounced
  watcher patches still coalesce, and queued patches are dropped when the final
  value returns to the original baseline.
- [`watcher-baseline-tests.md`](slices/phase-6-client-loop-suppression/watcher-baseline-tests.md) -
  implemented; settings, chat, script-definition, and existing lorebook tests
  cover server-origin refreshes, local edits after refresh, and rollback
  suppression.

## Exit Criteria

- Memory job UI avoids overlapping list requests and relies on SSE where
  possible. Done.
- Server projection application cannot be mistaken for a local edit by bridge
  watchers. Done.
- High-frequency settings controls continue to coalesce and skip equality-noop
  writes. Done.
- Watcher behavior has tests for server-origin refreshes. Done.

## Validation

- `pnpm test -- src/ts/server`
- Focused component or bridge tests for changed watchers.
