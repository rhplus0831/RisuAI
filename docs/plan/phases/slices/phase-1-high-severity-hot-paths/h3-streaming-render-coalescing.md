# H3 — Streaming Render Coalescing

Status: not started. Phase 1. Removes accidentally-quadratic per-token re-parsing
from the streaming render path.

## Scope

During a streamed response the server emits one SSE `token` frame per provider
delta (no batching); the client accumulates the full string each token and writes
it into `message[msgIndex].data` + bumps `reloadKeys` every frame. That deep
mutation re-runs `risuChatParser` + `ParseMarkdown`
(`parseAdditionalAssets` + `processScriptFull('editdisplay')` [display trigger +
CBS] + `md.render` + `DOMPurify.sanitize`) over the **whole** growing message
every token — ~O(length²) on the main thread. Coalesce the renders.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  finding **H3**.
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

- Buffer incoming token frames and flush the displayed text at most once per
  animation frame (or short timer), so the full reparse runs a bounded number of
  times regardless of token count.
- Keep a final full-fidelity flush on the terminal `done` frame so the persisted
  / final text parses once at full fidelity (and `editoutput` still runs).
- Optionally batch provider deltas into fewer, larger SSE frames server-side
  (low-risk, helps every client) — secondary.
- Do **not** prefix-memo `ParseMarkdown`: `editdisplay`/`display`/CBS can depend
  on the whole message and trailing context, so a naive prefix cache could render
  wrong mid-stream. Render coalescing is the behavior-preserving fix.

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
