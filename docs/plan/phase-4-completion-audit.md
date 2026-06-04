# Phase 4 Completion Audit

Date: 2026-06-05

Scope: Active Phase 4 outbound request lifecycle workstream in
`docs/plan/phases/phase-4-outbound-request-lifecycle.md`, covering M6, M8,
L20, L22, L23, L24, L25, and the Phase 8 gate registration.

## Verdict

Phase 4 should not be treated as fully complete yet.

Most of the implementation and regression coverage matches the Phase 4
checklist, but Lua egress fetches do not receive the originating request's
`AbortSignal`. That leaves one path in the stated "Lua fetch paths" scope
uncanceled until its own egress timeout instead of canceling promptly when the
originating request ends.

## Blocking Finding

### Lua `request()` egress does not abort on originating request cancellation

The Phase 4 goal says every outbound request should have a wall-clock bound and
cancel when its originating request ends. The Phase 4 slice also scopes abort
propagation to proxy, non-durable provider, and Lua fetch paths.

The implementation threads `ctx.signal` into `runServerLua`, and host functions
check that signal before dispatch. However, once Lua `request()` has entered the
egress fetch, the signal is not passed into `serverLuaRequest` or the pinned
HTTPS fetch:

- `server/fastify/src/prompt/luaRuntime.ts:933` declares `request()` and calls
  `serverLuaRequest(String(url ?? ''), state.ctx.egress, state.ctx.rateState ??
  sharedRateState)` without passing `state.ctx.signal`.
- `server/fastify/src/prompt/luaRuntime.ts:359` defines `serverLuaRequest`
  without a signal parameter.
- `server/fastify/src/prompt/luaRuntime.ts:312` defines `pinnedHttpsFetch`
  without a signal parameter or abort listener.
- `server/fastify/src/prompt/luaRuntime.ts:61` still gives Lua egress its own
  10 second wall-clock timeout, so this is bounded, but not canceled by the
  originating request as Phase 4 requires.

Current L20 tests cover an already-aborted signal and abort during `sleep()` /
host-function checkpoints, but they do not cover abort while a Lua egress
request is in flight:

- `server/fastify/__tests__/luaRuntime.test.ts:370`
- `server/fastify/__tests__/luaRuntime.test.ts:389`

Recommended closeout: pass the originating `AbortSignal` through
`serverLuaRequest` and `pinnedHttpsFetch`, destroy the active HTTPS request on
abort, and add a regression where a low-level Lua `request():await()` is
in-flight when the request signal aborts.

## Satisfied Items

### M6: proxy `/fetch` abort-on-close and request timeout backstop

Implemented. `/api/v1/proxy/fetch` creates a close-driven abort signal, combines
it with the optional timeout using `AbortSignal.any`, passes that signal to
upstream `fetch`, and removes the close listener in `finally`.

Evidence:

- `server/fastify/src/routes/proxy.ts:49`
- `server/fastify/src/routes/proxy.ts:57`
- `server/fastify/src/routes/proxy.ts:67`
- `server/fastify/src/routes/proxy.ts:103`
- `server/fastify/src/app.ts:65`
- `server/fastify/src/app.ts:96`
- `server/fastify/__tests__/proxy.test.ts:337`
- `server/fastify/__tests__/proxy.test.ts:342`

### M8: non-durable provider deadline and buffered body cap

Implemented. `attachAbort` defaults to the durable 600 second reference,
aborts on `req.raw` close, unrefs its timer, and cleans up listener/timer state.
Buffered provider bodies go through the 32 MB bounded read helpers.

Evidence:

- `server/fastify/src/requestAbort.ts:13`
- `server/fastify/src/requestAbort.ts:28`
- `server/fastify/src/generation/body.ts:11`
- `server/fastify/__tests__/requestAbort.test.ts:24`
- `server/fastify/__tests__/generationBodyCap.test.ts:57`

Coverage note: the Phase 8 gate entry for M8 points to the deadline regression;
the body-cap proof is present in `generationBodyCap.test.ts`, but is not named
by the gate entry.

### L20: request signal threaded into Lua runtime

Partially implemented. The route/job signal is threaded into assembly and
`runServerLua`, and the runtime has pre-start, load-thread, host-function, and
`sleep()` abort checkpoints. The Lua egress fetch gap above keeps the overall
L20/Phase 4 scope incomplete.

Evidence:

- `server/fastify/src/routes/generationChat.ts:846`
- `server/fastify/src/routes/generationChat.ts:1522`
- `server/fastify/src/routes/generationChat.ts:1842`
- `server/fastify/src/prompt/assemble.ts:451`
- `server/fastify/src/prompt/assemble.ts:618`
- `server/fastify/src/prompt/luaRuntime.ts:696`
- `server/fastify/src/prompt/luaRuntime.ts:997`
- `server/fastify/src/prompt/luaRuntime.ts:1032`

### L22: streaming-provider accumulation buffer cap

Implemented. The shared stream buffer cap is 8 MB, and the streaming adapters
check it after draining complete events or lines.

Evidence:

- `server/fastify/src/generation/sse.ts:13`
- `server/fastify/src/generation/openai.ts:352`
- `server/fastify/src/generation/anthropic.ts:337`
- `server/fastify/src/generation/mistral.ts:391`
- `server/fastify/src/generation/gemini.ts:453`
- `server/fastify/src/generation/ollama.ts:299`
- `server/fastify/__tests__/openai.test.ts:549`
- `server/fastify/__tests__/ollama.test.ts:516`

Coverage note: direct no-delimiter overflow tests exist for OpenAI SSE and
Ollama NDJSON. Anthropic, Mistral, and Gemini use the same cap path but do not
have separate direct overflow tests.

### L23: embedded-private IPv6 SSRF blocking

Implemented. The IPv6 guard unwraps mapped-hex, IPv4-compatible, 6to4, and
well-known NAT64 embedded IPv4 forms and classifies the embedded address.

Evidence:

- `server/fastify/src/prompt/luaRuntime.ts:175`
- `server/fastify/src/prompt/luaRuntime.ts:227`
- `server/fastify/__tests__/luaRuntime.test.ts:194`

### L24: prototype-key rejection in `setObjectValue`

Implemented. `setObjectValue` drops entries whose dotted key contains
`__proto__`, `constructor`, or `prototype`, preventing prototype traversal and
pollution.

Evidence:

- `server/fastify/src/generation/additionalParams.ts:110`
- `server/fastify/src/generation/additionalParams.ts:112`
- `server/fastify/__tests__/additionalParams.test.ts:168`

### L25: Lua egress rate counter increments only after validation

Implemented. `serverLuaRequest` validates the URL first and increments the
egress rate counter only after validation succeeds.

Evidence:

- `server/fastify/src/prompt/luaRuntime.ts:376`
- `server/fastify/src/prompt/luaRuntime.ts:385`
- `server/fastify/__tests__/luaRuntime.test.ts:280`

### Phase 8 gate registration

Implemented for the Phase 4 IDs. M6, M8, L20, L22, L23, L24, and L25 are marked
`DONE` with test paths and names in the fix completeness gate.

Evidence:

- `src/ts/__tests__/fixCompletenessGate.test.ts:116`
- `src/ts/__tests__/fixCompletenessGate.test.ts:130`
- `src/ts/__tests__/fixCompletenessGate.test.ts:243`
- `src/ts/__tests__/fixCompletenessGate.test.ts:252`
- `src/ts/__tests__/fixCompletenessGate.test.ts:260`
- `src/ts/__tests__/fixCompletenessGate.test.ts:269`
- `src/ts/__tests__/fixCompletenessGate.test.ts:277`

## Validation Performed

- `pnpm api:test -- server/fastify/__tests__/proxy.test.ts
  server/fastify/__tests__/requestAbort.test.ts
  server/fastify/__tests__/generationBodyCap.test.ts
  server/fastify/__tests__/luaRuntime.test.ts
  server/fastify/__tests__/additionalParams.test.ts
  server/fastify/__tests__/openai.test.ts
  server/fastify/__tests__/ollama.test.ts`

  Result: the command ran the full Fastify suite, 98 test files passed, 1692
  tests passed, 1 skipped.

- `pnpm test -- src/ts/__tests__/fixCompletenessGate.test.ts`

  Result: the command ran the full root suite, 118 test files passed, 1121 tests
  passed, 4 skipped. The known `127.0.0.1:3000` connection-refused noise did not
  fail the run.
