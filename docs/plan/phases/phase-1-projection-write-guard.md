# Phase 1: Projection Write Guard

Status: planned. The single highest-leverage fix; one primary slice plus an
optional secondary batching slice.

Goal: stop `withTrustedServerProjectionWrite` deep-cloning the whole `Database`
twice per guarded write. The guard is the amplifier behind the streaming,
non-stream, SSE-apply, chat-open-hydration, and prompt-template-keystroke
findings; one fix benefits ~100 call sites at once.

The guard runs at depth-1 entry
(`DBState.db = snapshotServerProjectionValue(DBState.db)`) and on refreeze
(`DBState.db = createReadOnlyServerProjection(snapshotServerProjectionValue(...))`).
On entry the proxy WeakMap hits and returns `structuredClone(source)` — a full
deep clone of the entire `Database`. On refreeze the WeakMap misses and it falls
to `$state.snapshot(value)` — a second full deep clone. Both traverse every
character, every hydrated chat, every `message[]`.

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
  keep one persistent mutable working copy (the source the proxy wraps); on
  depth-1 entry, unwrap `DBState.db` to that source via
  `readOnlyServerProjectionSources.get(proxy)` and assign the bare source (no
  clone); on refreeze, re-wrap the same source in a freshly-minted read-only
  proxy, evicting it from `readOnlyServerProjectionTargets` first so Svelte sees a
  new identity. Interim fallback if the proxy swap is risky: drop the
  refreeze-time `$state.snapshot` (wrap the already-cloned object as-is), which
  alone halves the cost.
- [`streaming-and-completion-batching.md`](slices/phase-1-projection-write-guard/streaming-and-completion-batching.md) -
  (secondary, independent) hold one trusted-write scope across the streaming tail
  (`streamResponse.ts` `while` loop) and batch the 2-3 non-nested guarded calls
  per message-append in `nonStreamResponse.ts`, so the enter/refreeze transition
  happens at most once per response rather than per chunk.

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
  the Phase 9 optimistic-write guard invariants still hold.

## Validation

- The guard suite under `src/ts/server/` / `src/lib/Others/` (copy-on-write
  proof + reactivity + immutability).
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
