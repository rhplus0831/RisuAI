# Copy-On-Write Projection Guard

Status: planned. Phase 1. The single highest-leverage fix.

## Scope

Stop `withTrustedServerProjectionWrite` deep-cloning the whole `Database` twice
per guarded write. Keep one persistent mutable working copy (the source the
read-only proxy wraps); on entry unwrap to that source, on refreeze re-wrap it in
a fresh proxy. Both transitions become O(1).

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Critical guard finding and recommended-remediation step 1.
- `src/ts/server/projectionWriteGuard.svelte.ts` -
  `withTrustedServerProjectionWrite` (depth-1 entry at `:43`, refreeze at `:35`),
  `snapshotServerProjectionValue` (`:115` `$state.snapshot` branch, `:119`
  `structuredClone(source)` branch), `createReadOnlyServerProjection` /
  `createReadOnlyServerProjectionProxy`, `readOnlyServerProjectionSources`
  (proxy→source WeakMap), `readOnlyServerProjectionTargets` (source→proxy memo).

## Current Behavior

- On entry `DBState.db` is the read-only proxy →
  `readOnlyServerProjectionSources.get` hits → `structuredClone(source)` (full
  deep clone #1).
- On refreeze `DBState.db` is the plain cloned object → WeakMap miss →
  `$state.snapshot(value)` (full deep clone #2).
- Each guarded write = two full-`Database` deep clones, no field narrowing,
  including all hydrated `message[]`.

## Target Implementation

- On depth-1 entry: unwrap the proxy to its source
  (`readOnlyServerProjectionSources.get(DBState.db)`) and assign the bare source
  to `DBState.db` (no clone). The proxy already enforced immutability recursively,
  so no defensive value copy is needed — the source is the single mutable working
  copy the guarded callback mutates directly.
- On refreeze: re-wrap the same source in a freshly-minted read-only proxy. The
  proxy factory memoizes per target via `readOnlyServerProjectionTargets`, so
  **evict the source from that memo before re-wrapping** (or bypass the memo) so a
  new proxy identity is produced and Svelte's `DBState.db` signal fires
  reactivity.
- Verify no consumer reads `DBState.db` reactively mid-write expecting a fresh
  `$state` proxy per write; the source is a stable identity between entry and
  refreeze (that is the point), so any such consumer must tolerate it.

## Interim Mitigation

If the proxy unwrap-rewrap is judged risky for a first landing, drop only the
**second** clone: on refreeze wrap the already-cloned plain object as-is instead
of re-running `$state.snapshot`. That alone halves the per-write cost and is a
strictly smaller change; the full copy-on-write follows.

## Behavior / Invariants

- `DBState.db` remains a read-only projection after the guard returns (out-of-guard
  writes still throw).
- One new proxy identity per top-level guarded write so dependent `$effect`s
  re-run exactly as before.
- The command/event/revision contract and the depth counter semantics are
  unchanged; only the snapshot strategy changes.

## Done When

- A guarded one-field write on a seeded multi-chat hydrated DB performs zero
  full-`Database` clones (clone-cost harness) and stays O(1) in time.
- Reactivity and immutability tests pass: a dependent effect re-runs after the
  write; an out-of-guard mutation throws.
- `pnpm test`, `pnpm api:test`, and `pnpm client-thinning:audit` are green; the
  Phase 9 optimistic-write guard gap regression (re-read inside the guard) still
  passes.

## Validation

- The projection-guard suite (copy-on-write + reactivity + immutability).
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
