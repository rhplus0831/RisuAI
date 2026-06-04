# Phase 4: Outbound Request Lifecycle (Root 4)

Status: COMPLETE (`bf1a6cb2`; completion-audit closeout 2026-06-05). Timeouts,
abort propagation, and egress hardening landed for proxy, non-durable provider,
and Lua fetch paths. The completion audit
([`../phase-4-completion-audit.md`](../phase-4-completion-audit.md)) found one
gap — Lua `request()` egress fetches did not receive the originating request's
`AbortSignal` — closed by threading the signal through `serverLuaRequest` and
`pinnedHttpsFetch` (destroying the in-flight HTTPS request on abort), plus
direct L22 overflow tests for the anthropic/mistral/gemini adapters and gate
entries naming every proof.

Goal: every outbound request has a generous wall-clock bound and cancels when its
originating request ends. SSRF/egress/injection guards cover the known bypasses.

Findings: M6, M8, L20, L22, L23, L24, L25.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M6, M8, L20, L22, L23, L24, L25.
- `server/fastify/src/routes/proxy.ts` (`/proxy/fetch`), `server/fastify/src/proxy.ts`
  (`createTimeoutController`, `getRequestTimeoutMs`), `server/fastify/src/app.ts`
  (no `requestTimeout`).
- `server/fastify/src/routes/generation.ts` (`attachAbort` :371),
  `server/fastify/src/routes/generationChat.ts` (`attachAbort` :201, non-durable
  `streamAssembly`), `server/fastify/src/generation/*.ts` (buffered + streaming
  adapters; `sse.ts` `popSseEventBlock`), `server/fastify/src/generation/horde.ts`.
- `server/fastify/src/prompt/luaRuntime.ts` (`runServerLua` signal, `isBlockedV6`
  :175, `serverLuaRequest` rate counter :311), `server/fastify/src/generation/additionalParams.ts`
  (`setObjectValue` :104).

## Slices

- [`outbound-request-lifecycle.md`](slices/phase-4-outbound-request-lifecycle/outbound-request-lifecycle.md) -
  full batch:
  - M6: proxy `/fetch` aborts the upstream on `req.raw` close
    (`AbortSignal.any([timeout.signal, closeSignal])`, listener removed in
    `finally`); add a generous Fastify `requestTimeout` backstop.
  - M8: install a bounded deadline in `attachAbort` (mirroring the durable 600s
    `deadlineAt`) so buffered + streaming non-durable paths and the standalone
    `routes/generation.ts` endpoints are bounded in two spots; add a body-size cap
    when buffering provider bodies.
  - L20: thread the request `AbortSignal` into `runServerLua` so client
    disconnect cancels in-flight hook work.
  - L22: cap the streaming-provider SSE accumulation buffer so a missing delimiter
    cannot grow it unbounded.
  - L23: unwrap 6to4 / NAT64 / IPv4-compatible embedded private addresses in the
    IPv6 SSRF guard [known-leftover: hosted-Lua].
  - L24: reject dotted `__proto__`/`constructor`/`prototype` keys in
    `setObjectValue` (prototype pollution).
  - L25: increment the Lua egress rate counter only after `validateEgressUrl`
    passes.

## Planned Shape

- M6/M8 use the durable path's 600s `deadlineAt` as the reference default.
- L20's signal must abort the wasmoon run (cooperate with the existing
  `functionTimeout`/`lua_sethook` exec limit), not just the surrounding fetch.
- L23/L24/L25 are small defensive guards and self-host robustness wins.

## Exit Criteria

- [x] M6: a client disconnect during a `/proxy/fetch` aborts the upstream; a
      `requestTimeout` backstop exists; the close listener is removed in `finally`.
      (`proxy.test.ts` M6 block — the disconnect test was proven failing
      without the fix; `REQUEST_RECEIVE_TIMEOUT_MS` = 600s in `app.ts`.)
- [x] M8: non-durable buffered/streaming provider requests are bounded by a
      generous deadline and a body-size cap; a slow-but-valid local model is not
      aborted prematurely (the 600s default mirrors the durable reference;
      `requestAbort.test.ts` + `generationBodyCap.test.ts`).
- [x] L20: aborting the request cancels in-flight Lua hook work
      (`luaRuntime.test.ts` L20 block — entry, load, host-fn checkpoints, and
      an in-flight `request()` egress fetch torn down on abort).
- [x] L22: a streaming response with no delimiter is bounded, not unbounded
      (8 MB cap in `generation/sse.ts`; direct overflow tests in
      `openai.test.ts`, `anthropic.test.ts`, `mistral.test.ts`,
      `gemini.test.ts`, `ollama.test.ts`).
- [x] L23: embedded-private IPv6 forms are blocked (mapped-hex / compatible /
      6to4 / NAT64 payloads in `luaRuntime.test.ts`; public transition forms
      stay reachable).
- [x] L24: `setObjectValue` cannot pollute `Object.prototype`
      (`additionalParams.test.ts` dotted-key payloads).
- [x] L25: a blocked URL does not consume the egress budget
      (`luaRuntime.test.ts` L25 test).
- [x] Gates registered in Phase 8; server suite + audit + TypeScript checks green.

## Validation

- `pnpm api:test -- server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/generation.test.ts`
  (M6, M8, L22).
- `pnpm api:test -- server/fastify/__tests__/luaRuntime*.test.ts` (L20, L23, L25;
  add SSRF/abort/rate-counter cases).
- A `setObjectValue` prototype-pollution unit test (L24).
- `pnpm api:test`, both TypeScript checks.
