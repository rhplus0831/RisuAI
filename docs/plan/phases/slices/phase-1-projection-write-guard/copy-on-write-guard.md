# Copy-On-Write Projection Guard

Status: implemented. Phase 1. The single highest-leverage fix.

Landed in `src/ts/server/projectionWriteGuard.svelte.ts`: entry hands the
callback a writable pass-through working copy (`new Proxy(source, {
getPrototypeOf })` — the custom prototype stops Svelte's `$state` from
deep-proxying it, so mutations write through to the plain source with no clone);
refreeze re-wraps the same source via `createReadOnlyServerProjection`, which now
uses a per-wrap memo so the whole proxy tree gets fresh identities (reactivity
preserved). Achieved zero clones, beyond the interim half-cost mitigation. The
hydration reactivity test (`chatMessageHydration.reactivity.svelte.test.ts`)
caught that a global nested-proxy memo would freeze `$derived` chains; the
per-wrap memo fixes it. Proof: `src/ts/server/projectionWriteGuard.test.ts`.

## Scope

Stop `withTrustedServerProjectionWrite` from cloning the whole `Database` twice
per guarded write. Keep one mutable working copy, unwrap to it on entry, and
re-wrap it in a fresh proxy on refreeze. Both transitions become O(1).

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Critical guard finding and recommended-remediation step 1.
- `src/ts/server/projectionWriteGuard.svelte.ts` -
  `withTrustedServerProjectionWrite` (depth-1 entry at `:43`, refreeze at `:35`),
  `snapshotServerProjectionValue` (`:115` `$state.snapshot` branch, `:119`
  `structuredClone(source)` branch), `createReadOnlyServerProjection` /
  `createReadOnlyServerProjectionProxy`, `readOnlyServerProjectionSources`
  (proxy->source WeakMap), `readOnlyServerProjectionTargets` (source->proxy memo).

## Current Behavior

- On entry `DBState.db` is the read-only proxy.
  `readOnlyServerProjectionSources.get` hits, then `structuredClone(source)`
  performs full clone #1.
- On refreeze `DBState.db` is the plain cloned object. The WeakMap misses, then
  `$state.snapshot(value)` performs full clone #2.
- Each guarded write = two full-`Database` deep clones, no field narrowing,
  including all hydrated `message[]`.

## Target Implementation

- On depth-1 entry: unwrap the proxy source with
  `readOnlyServerProjectionSources.get(DBState.db)` and assign that source to
  `DBState.db` with no clone.
- On refreeze: re-wrap the same source in a fresh read-only proxy. Evict or
  bypass `readOnlyServerProjectionTargets` first so Svelte observes a new
  `DBState.db` identity.
- Verify no consumer reads `DBState.db` reactively mid-write expecting a fresh
  `$state` proxy per write; the source is a stable identity between entry and
  refreeze (that is the point), so any such consumer must tolerate it.

## Interim Mitigation

If the full proxy swap is risky, first drop only the second clone: on refreeze,
wrap the already-cloned object as-is instead of running `$state.snapshot` again.
That halves the per-write cost.

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
- `pnpm test`, `pnpm api:test`, and `pnpm client-thinning:audit` are green. The
  optimistic-write guard gap regression (re-read inside the guard) still passes.

## Validation

- The projection-guard suite (copy-on-write + reactivity + immutability).
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
