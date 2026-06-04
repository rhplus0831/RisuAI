# Streaming & Completion Write Batching

Status: deferred (optional). Phase 1. Secondary and independent.

Rationale for deferral: this slice batched guard enter/refreeze transitions to
amortize the per-write whole-`Database` clone. The copy-on-write slice removed
that clone, so each transition is now O(1). The remaining per-chunk transition is
the `DBState.db` identity flip that drives incremental streaming render, which we
want to keep. Reopen only if profiling shows per-chunk guard transitions (proxy
tree minting, not cloning) are a measurable cost on a hydrated DB.

## Scope

Reduce guard enter/refreeze transitions in generation write paths. Pay the guard
cost once per response or message append, not per chunk.

## Source Anchors

- [`../../../../../frontend-performance-audit.md`](../../../../../frontend-performance-audit.md) -
  the Critical streaming finding ("Secondary" fix) and the High non-stream
  finding ("Secondary" fix).
- `src/ts/process/postGeneration/streamResponse.ts` - the per-chunk
  `withTrustedServerProjectionWrite` inside the stream loop; after the tail
  message append, subsequent chunks only touch `message[msgIndex].data` +
  `reloadKeys`.
- `src/ts/process/postGeneration/nonStreamResponse.ts` - the 2-3 non-nested
  guarded calls per appended message.
- `src/ts/process/postGeneration/orchestrateResponse.ts` -
  `consumeStreamResponse` / `applyNonStreamResponse` callers (the streaming call
  is awaited and not wrapped in an outer trusted write, so each inner call runs
  at guard depth 0).

## Target Implementation

- Streaming: wrap the whole `while` loop in one
  `withTrustedServerProjectionWrite`, or add a narrow mutator for
  `message[msgIndex].data` + `reloadKeys`. Preserve per-chunk render cadence and
  abort handling.
- Non-stream: batch the 2-3 separate `withTrustedServerProjectionWrite` calls per
  message-append into a single guarded scope. The awaited `inlayResult.promise`
  blocks may force a separate scope - resolve inlay text before opening the
  guarded scope, or accept one extra scope.

## Behavior / Invariants

- Streamed text lands identically chunk-by-chunk (same `reloadKeys` render
  cadence); abort mid-stream behaves identically.
- The final persisted message and the `serverOwnsPostGeneration` path are
  unchanged.
- This slice only changes guard scope count.

## Done When

- The streaming loop performs at most one guard enter/refreeze for the tail
  message's chunk run (verified by counting transitions over a multi-chunk
  stream).
- A non-stream completion performs one guarded scope per message-append (not
  2-3).
- Streamed/persisted output is byte-identical; `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/orchestrateResponse.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
