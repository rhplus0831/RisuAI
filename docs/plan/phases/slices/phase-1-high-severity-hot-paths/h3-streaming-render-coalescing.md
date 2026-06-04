# H3 — Streaming Render Coalescing

Status: IMPLEMENTED (`e41dc6c6`). Phase 1. Removes quadratic per-token parsing
from streaming renders.

Landed shape: new `src/ts/process/postGeneration/streamCoalescer.ts`
(`createStreamRenderCoalescer`: `notify()` per chunk, serialized `apply` at
most once per animation frame on the newest payload, `settle()` final
full-fidelity apply, first apply failure surfaced for fail-fast).
`consumeStreamResponse` notifies the coalescer per chunk instead of writing
`.data` + bumping `reloadKeys` per token; `settle()` runs after the loop (and
error-swallowed in `finally` so a reader error still flushes the last received
chunk without being masked). `editoutput` runs per flush, final text identical.
Server-side SSE batching (the optional extra) was not needed. Proofs:
`streamCoalescer.test.ts` unit suite + `streamResponse.test.ts` H3 block
(200-token stream applies O(flushes) parses; frame-paced display progress via
the `renderFlushScheduler` test seam; mid-stream script-error propagation).
Gate `H3` flipped in `fixCompletenessGate.test.ts` + `active-risk-analysis.md`.

## Scope

During streaming, each provider delta becomes an SSE `token` frame. The client
writes the full accumulated string to `message[msgIndex].data` and bumps
`reloadKeys` every frame. That re-runs `risuChatParser` + `ParseMarkdown` over
the whole growing message, making long streams ~O(length²). Coalesce the
renders.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  finding H3.
- `src/ts/process/request/serverChat.ts:409-412` (per-token full-string enqueue,
  no rAF/throttle).
- `src/ts/process/postGeneration/streamResponse.ts:104-133` (per-chunk `.data`
  write + `reloadKeys`).
- `src/lib/ChatScreens/Chat.svelte:375` (`$effect.pre` -> `displaya`/
  `risuChatParser`), `src/lib/ChatScreens/ChatBody.svelte:259`
  (`markParsingResult` -> `markParsing`), `src/ts/parser/parser.svelte.ts`
  (`ParseMarkdown` :822, `risuChatParser` :55 — no memo).
- `server/fastify/src/routes/generation.ts:394` (`writeSseChunk`, optional
  server-side batching).

## Planned Shape

- Buffer token frames and flush displayed text at most once per animation frame
  or short timer.
- Keep a final full-fidelity flush on the terminal `done` frame so the persisted
  / final text parses once at full fidelity (and `editoutput` still runs).
- Optionally batch provider deltas into fewer SSE frames server-side.
- Do not prefix-memo `ParseMarkdown`: `editdisplay`/`display`/CBS can depend on
  the whole message and trailing context.

## Behavior / Invariants

- Final rendered output and persisted text are identical to today.
- Auto-scroll and the streaming "in progress" UX are preserved.
- The terminal frame still applies the final parse, `editoutput`, and the
  revision reconcile.

## Done Criteria

- For a synthetic N-token stream, the displayed message is parsed O(flushes), not
  O(N); a test bounds the render/parse count.
- Rendered output for a representative markdown/CBS/display-script message is
  byte-identical before and after.
- Gate `H3` registered in the Phase 8 completeness map.

## Validation

- `pnpm test -- src/lib/ChatScreens` plus the parser suite (bounded parse-count
  test; output-identity test).
- Browser profiler spot-check on a long stream (`ParseMarkdown` self-time stays
  bounded).
- `pnpm test`, both TypeScript checks.
