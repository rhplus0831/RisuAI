# Phase 1: Projection Write Guard

Status: planned. The single highest-leverage fix; one primary slice plus an
optional secondary batching slice.

Goal: stop `withTrustedServerProjectionWrite` cloning the whole `Database` twice
per guarded write. This removes the amplifier behind streaming, completion, SSE
apply, chat-open hydration, and prompt-template editing.

Current behavior: depth-1 entry unwraps the read-only proxy by returning
`structuredClone(source)`. Refreeze misses the WeakMap and falls back to
`$state.snapshot(value)`. Together they clone every character, hydrated chat, and
`message[]`.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the two Critical guard/streaming findings and recommended-remediation step 1.
- `src/ts/server/projectionWriteGuard.svelte.ts` -
  `withTrustedServerProjectionWrite`, `snapshotServerProjectionValue` (`:115`,
  `:119`), `createReadOnlyServerProjection`/`createReadOnlyServerProjectionProxy`,
  `readOnlyServerProjectionSources`, `readOnlyServerProjectionTargets`.
- `src/ts/bootstrap.ts` - `setServerProjectionWriteGuardEnabled(true)` (default in
  fastify/web mode).
- `src/ts/process/postGeneration/streamResponse.ts:129`,
  `nonStreamResponse.ts:116`, `src/ts/storage/database.svelte.ts:803/886` - the
  amplified call sites this phase relieves.

## Slices

- [`copy-on-write-guard.md`](slices/phase-1-projection-write-guard/copy-on-write-guard.md) -
  keep one mutable working copy. On entry, assign the proxy source with no clone.
  On refreeze, wrap the same source in a fresh read-only proxy so Svelte sees a
  new identity. Fallback: skip only the refreeze-time `$state.snapshot`, which
  halves the cost.
- [`streaming-and-completion-batching.md`](slices/phase-1-projection-write-guard/streaming-and-completion-batching.md) -
  secondary: hold one trusted-write scope across streaming tails and batch the
  non-stream guarded calls per message append.

## Exit Criteria

- [ ] A guarded write of a single field on a multi-chat hydrated DB performs no
  full-`Database` `structuredClone` and no full `$state.snapshot` (verified by
  instrumentation / timing staying O(1), not O(DB)).
- [ ] After a guarded write, `DBState.db` is still a read-only projection (writes
  outside the guard throw), and Svelte reactivity fires (a new identity is
  observed by dependent effects).
- [ ] Nothing that reads `DBState.db` reactively mid-write breaks (no consumer
  depends on receiving a fresh `$state` proxy per write).
- [ ] `pnpm test`, `pnpm api:test`, and `pnpm client-thinning:audit` are green;
  the optimistic-write guard invariants still hold.

## Validation

- The guard suite under `src/ts/server/` / `src/lib/Others/` (copy-on-write
  proof + reactivity + immutability).
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
