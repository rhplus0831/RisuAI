# Phase 1: Projection Write Guard

Status: implemented (primary copy-on-write slice). The single highest-leverage
fix. The optional secondary batching slice is deferred.

Goal: stop `withTrustedServerProjectionWrite` cloning the whole `Database` twice
per guarded write. This removes the amplifier behind streaming, completion, SSE
apply, chat-open hydration, and prompt-template editing.

Old behavior: depth-1 entry unwrapped the read-only proxy by returning
`structuredClone(source)`. Refreeze missed the WeakMap and fell back to
`$state.snapshot(value)`. Together they cloned every character, hydrated chat, and
`message[]`.

## Implementation

`src/ts/server/projectionWriteGuard.svelte.ts`:

- Depth-1 entry hands the callback a writable **pass-through working copy** of the
  projection source: `new Proxy(source, { getPrototypeOf })`. The custom
  prototype makes Svelte's `$state` skip deep-proxying it (verified empirically),
  so the source keeps its plain identity and the callback's mutations write
  straight through to it — no clone.
- Refreeze re-wraps the same mutated source in a fresh read-only proxy.
  `createReadOnlyServerProjection` now uses a **per-wrap memo**, so every guarded
  write mints a brand-new proxy tree (new identity top-to-bottom). That preserves
  the exact reactivity the old deep-clone produced (dependent `$derived` chains
  re-run, e.g. `DefaultChatScreen`'s loading overlay) without cloning data.
- `resolveServerProjectionSource` unwraps whatever `DBState.db` holds — the
  working copy, a read-only proxy (the apply path re-applies a full projection),
  or a foreign/raw object (the only path that still clones, via `$state.snapshot`,
  matching the old refreeze on that rare full-replacement case).

The depth counter, command/event/revision contract, and read-only immutability
are unchanged; only the snapshot strategy changed. Proof:
`src/ts/server/projectionWriteGuard.test.ts`.

## Source Anchors

- [`../../../frontend-performance-audit.md`](../frontend-performance-audit.md) -
  the two Critical guard/streaming findings and recommended-remediation step 1.
- `src/ts/server/projectionWriteGuard.svelte.ts` -
  `withTrustedServerProjectionWrite`, `createReadOnlyServerProjection`,
  `createTrustedServerProjectionWorkingCopy`, `resolveServerProjectionSource`,
  `readOnlyServerProjectionSources`, and `trustedServerProjectionWorkingCopies`.
- `src/ts/bootstrap.ts` - `setServerProjectionWriteGuardEnabled(true)` (default in
  fastify/web mode).
- `src/ts/process/postGeneration/streamResponse.ts`,
  `src/ts/process/postGeneration/nonStreamResponse.ts`, and
  `src/ts/storage/database.svelte.ts` - representative guarded write call sites
  this phase relieves.

## Slices

- [`copy-on-write-guard.md`](slices/phase-1-projection-write-guard/copy-on-write-guard.md) -
  IMPLEMENTED. Keep one mutable working source. On entry, hand the callback a
  writable pass-through proxy over it with no clone. On refreeze, wrap the same
  source in a fresh read-only proxy tree so Svelte sees a new identity. Went
  beyond the interim mitigation: zero clones, not half.
- [`streaming-and-completion-batching.md`](slices/phase-1-projection-write-guard/streaming-and-completion-batching.md) -
  DEFERRED (optional). It batched guard transitions to amortize the per-write
  clone. With the clone gone, each transition is O(1), so the batching value is
  small and the per-chunk `DBState.db` identity flip is the desired incremental
  streaming render. Revisit only if profiling shows per-chunk transitions matter.

## Exit Criteria

- [x] A guarded write of a single field on a multi-chat hydrated DB performs no
      full-`Database` `structuredClone` and no full `$state.snapshot` (proven by the
      clone-cost harness: `structuredCloneCount === 0`, `maxClonedSize` below the
      characters-array size).
- [x] After a guarded write, `DBState.db` is still a read-only projection (writes
      outside the guard throw), and Svelte reactivity fires (a new identity is
      observed; the `DefaultChatScreen` loading-overlay derived chain flips).
- [x] Nothing that reads `DBState.db` reactively mid-write breaks — the
      per-wrap-memo fix restores fresh nested proxy identities so no consumer that
      depended on a fresh proxy per write regresses (the hydration reactivity test
      caught and now guards this).
- [x] Landing verification was green, and the optimistic-write guard invariants
      still hold. Current maintained verification is in
      [`../latest-verification.md`](../latest-verification.md).

## Validation

- The guard suite under `src/ts/server/` / `src/lib/Others/` (copy-on-write
  proof + reactivity + immutability).
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
