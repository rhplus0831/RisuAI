# Copy-On-Write Projection Guard

Status: implemented. Phase 1. The single highest-leverage fix.

Implemented: `withTrustedServerProjectionWrite` now mutates a writable
pass-through working proxy and refreezes the same source with a fresh read-only
proxy tree. A guarded one-field write performs zero full-`Database` clones while
preserving immutability and reactivity. Proofs live in
`projectionWriteGuard.test.ts` and `chatMessageHydration.reactivity.svelte.test.ts`.

## Scope

Stop `withTrustedServerProjectionWrite` from cloning the whole `Database` twice
per guarded write. Keep one mutable working copy, unwrap to it on entry, and
re-wrap it in a fresh proxy on refreeze. Both transitions become O(1).

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Critical guard finding and recommended-remediation step 1.
- `src/ts/server/projectionWriteGuard.svelte.ts` -
  `withTrustedServerProjectionWrite`, `createReadOnlyServerProjection`,
  `createTrustedServerProjectionWorkingCopy`, `resolveServerProjectionSource`,
  `readOnlyServerProjectionSources`, and `trustedServerProjectionWorkingCopies`.

## Former Behavior

Before Phase 1, a top-level guarded write cloned the whole projection twice:
entry used `structuredClone(source)` and refreeze fell back to
`$state.snapshot(value)`. Every guarded scalar write therefore scaled with the
whole hydrated `Database`.

## Implemented Shape

- Depth-1 entry resolves the plain source behind `DBState.db` and assigns a
  writable pass-through working proxy over that source.
- Refreeze resolves the same mutated source and wraps it in a fresh read-only
  proxy tree. `createReadOnlyServerProjection` uses a per-wrap memo, so every
  guarded write gets fresh nested proxy identities without cloning data.
- `resolveServerProjectionSource` handles working proxies, read-only proxies, and
  rare raw/full-replacement values; only the raw replacement path still snapshots
  to unwrap a Svelte proxy.

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
