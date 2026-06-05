# Phase 4 Completion Audit

Date: 2026-06-05

Scope: Phase 4 outbound request lifecycle: M6, M8, L20, L22, L23, L24, L25,
and Phase 8 gate registration.

## Verdict

Closed. Phase 4 is complete.

The original audit found one blocking gap: Lua `request()` egress fetches did
not receive the originating request's `AbortSignal`. They had their own
10-second egress timeout, but they did not cancel promptly when the request
ended.

## Closeout

Implemented on 2026-06-05:

- `request()` now threads `state.ctx.signal` through `serverLuaRequest`.
- `EgressDeps.fetchImpl` receives the originating signal.
- `pinnedHttpsFetch` rejects immediately on already-aborted signals, destroys
  the active HTTPS request on abort, and removes its listener on socket close.
- Abort during DNS validation or mid-fetch throws `LuaAbortError` instead of
  returning a synthetic 400.
- Abort during validation no longer consumes the egress rate budget.

Regressions:

- `luaRuntime.test.ts`: aborting while a Lua `request()` egress fetch is
  in-flight cancels promptly.
- `luaRuntime.test.ts`: abort mid-fetch rejects through `serverLuaRequest`
  instead of returning a synthetic 400.
- The Phase 8 L20 gate entry names the in-flight regression via `extraTests`.

## Satisfied Items

- M6: `/api/v1/proxy/fetch` aborts upstream on client close, combines that
  signal with the timeout, and removes listeners in `finally`.
- M8: non-durable provider calls use the durable 600s deadline reference and
  32 MB bounded body reads.
- L20: route/job signals reach assembly and Lua. The runtime now checks abort
  before start, during load, at host functions, during `sleep()`, and during
  egress fetch.
- L22: streaming adapters share the 8 MB accumulation cap. Direct no-delimiter
  overflow tests cover OpenAI, Ollama, Anthropic, Mistral, and Gemini.
- L23: the IPv6 SSRF guard unwraps mapped-hex, IPv4-compatible, 6to4, and NAT64
  embedded IPv4 forms.
- L24: `setObjectValue` drops `__proto__`, `constructor`, and `prototype` path
  segments.
- L25: Lua egress rate counting happens only after URL validation.
- Phase 8: M6, M8, L20, L22, L23, L24, and L25 are registered as `DONE`.

## Validation

Initial focused run widened to the full suites:

- `pnpm api:test`: 98 files, 1692 passed, 1 skipped.
- `pnpm test`: 118 files, 1121 passed, 4 skipped.

Closeout run:

- `pnpm api:test`: 98 files, 1697 passed, 1 skipped.
- `pnpm test`: 118 files, 1121 passed, 4 skipped.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
