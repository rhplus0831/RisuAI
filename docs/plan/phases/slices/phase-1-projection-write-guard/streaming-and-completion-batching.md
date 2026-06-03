# Streaming & Completion Write Batching

Status: planned. Phase 1. Secondary and independent; worthwhile even with the
copy-on-write guard, and a safety net if the guard fix is staged.

## Scope

Reduce the number of guard enter/refreeze transitions on the two generation write
paths so the per-write cost (whatever it is after the copy-on-write guard) is paid
at most once per response / per message-append rather than per chunk.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Critical streaming finding ("Secondary" fix) and the High non-stream
  finding ("Secondary" fix).
- `src/ts/process/postGeneration/streamResponse.ts:129` - the per-chunk
  `withTrustedServerProjectionWrite` inside the `while (streamAborted === false)`
  loop (line 93); the tail message is appended once at line 68, subsequent chunks
  only touch `message[msgIndex].data` + `reloadKeys`.
- `src/ts/process/postGeneration/nonStreamResponse.ts:98/111/116/130/138` - the
  2-3 non-nested guarded calls per appended message (~4-6 clone pairs per
  completion).
- `src/ts/process/orchestrateResponse.ts:98/157` - `consumeStreamResponse` /
  `applyNonStreamResponse` callers (the streaming call is awaited and not wrapped
  in an outer trusted write, so each inner call runs at guard depth 0).

## Target Implementation

- Streaming: wrap the whole `while`-loop region in one
  `withTrustedServerProjectionWrite` so depth stays ≥1 across chunks and the
  enter/refreeze transition happens at most once for the streaming tail; or add a
  dedicated narrow mutator that updates `message[msgIndex].data` + `reloadKeys` on
  the live reactive object without re-entering the guard per chunk. Preserve the
  per-chunk render cadence (`reloadKeys` bump) and abort handling.
- Non-stream: batch the 2-3 separate `withTrustedServerProjectionWrite` calls per
  message-append into a single guarded scope. The awaited `inlayResult.promise`
  blocks may force a separate scope — resolve inlay text before opening the
  guarded scope, or accept one extra scope.

## Behavior / Invariants

- Streamed text lands identically chunk-by-chunk (same `reloadKeys` render
  cadence); abort mid-stream behaves identically.
- The final persisted message and the `serverOwnsPostGeneration` path are
  unchanged.
- This slice is purely about scope count; with the copy-on-write guard it removes
  residual per-chunk overhead, and without it (interim) it bounds the clone count.

## Done When

- The streaming loop performs at most one guard enter/refreeze for the tail
  message's chunk run (verified by counting transitions over a multi-chunk
  stream).
- A non-stream completion performs one guarded scope per message-append (not
  2-3).
- Streamed/persisted output is byte-identical; `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/process/postGeneration` (or the generation suite)
- `pnpm test`
- `pnpm client-thinning:audit`
