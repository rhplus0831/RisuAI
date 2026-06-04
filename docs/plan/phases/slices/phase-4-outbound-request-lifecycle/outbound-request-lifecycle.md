# Outbound Request Lifecycle

Status: COMPLETE (`bf1a6cb2`). Phase 4. Bundles outbound timeout/abort fixes
and egress hardening.

## Scope

Add generous wall-clock bounds and abort propagation to proxy, non-durable
provider, and Lua fetch paths. Close SSRF, prototype-pollution, and rate-counter
gaps.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M6, M8, L20, L22, L23, L24, L25.
- `server/fastify/src/routes/proxy.ts:33-96`, `server/fastify/src/proxy.ts:19-42`,
  `server/fastify/src/app.ts:80-84` (M6).
- `server/fastify/src/routes/generation.ts:371` (`attachAbort`),
  `server/fastify/src/routes/generationChat.ts:201`,
  `server/fastify/src/generation/openai.ts`, `horde.ts` (M8); `generation/sse.ts`
  (`popSseEventBlock`) + the streaming adapters (L22).
- `server/fastify/src/prompt/luaRuntime.ts:907` (signal, L20), `:175-182`
  (`isBlockedV6`, L23), `:311-321` (rate counter, L25);
  `server/fastify/src/generation/additionalParams.ts:104-119` (`setObjectValue`,
  L24).

## Item Checklist

- [x] M6 — proxy `/fetch` aborts upstream on `req.raw` close via
      `AbortSignal.any([timeout.signal, closeSignal])` (close-only signal when no
      `risu-timeout-ms` is present); the close listener is removed in `finally`;
      `buildApp` sets the `REQUEST_RECEIVE_TIMEOUT_MS` (600s) `requestTimeout`
      backstop.
- [x] M8 — the shared `attachAbort` (`src/requestAbort.ts`, used by
      `routes/generation.ts` + `routes/generationChat.ts`) installs the
      `NON_DURABLE_REQUEST_DEADLINE_MS` (= durable 600s `deadlineAt`) timer;
      every buffered provider body read goes through `readBoundedBodyText/Json`
      (`generation/body.ts`, 32 MB cap; all 12 adapters + `vertexAuth`).
- [x] L20 — `AssembleDeps.signal` → `AssemblyState.signal` →
      `ServerLuaRuntimeContext.signal`: `runServerLua` never boots on an aborted
      signal, every host fn is an abort checkpoint, `sleep` wakes early, and the
      load thread's deadline is pulled to "now" on abort (cooperating with the
      exec-limit hook). `streamAssembly`, the durable runner, and
      `preview-prompt` pass their signals.
- [x] L22 — the five streaming adapters cap the accumulation buffer
      (`MAX_STREAM_BUFFER_CHARS` = 8 MB in `generation/sse.ts`); a
      delimiter-less upstream yields one bounded error frame.
- [x] L23 — `isBlockedV6` unwraps IPv4-mapped-hex / IPv4-compatible / 6to4 /
      NAT64 embedded addresses and classifies the embedded IPv4
      [known-leftover: hosted-Lua].
- [x] L24 — `setObjectValue` drops entries whose dotted key contains
      `__proto__`/`constructor`/`prototype`.
- [x] L25 — the Lua egress rate counter increments only after
      `validateEgressUrl` passes.

## Behavior / Invariants

- Timeouts/caps change only failure mode. Use the durable 600s default as the
  reference.
- L20's abort must terminate the wasmoon run, not just the surrounding fetch.
- Egress guards must not block legitimate current requests.

## Done Criteria

All met by `bf1a6cb2`:

- M6: a disconnect mid-`/proxy/fetch` aborts the upstream (`proxy.test.ts` M6
  disconnect test, proven failing without the fix); backstop timeout
  configured; no listener leak.
- M8: non-durable provider requests have a generous deadline and body cap;
  `requestAbort.test.ts` proves the bound is the durable 600s reference and a
  slow-but-valid request inside the bound is not aborted;
  `generationBodyCap.test.ts` proves an over-cap body fails closed.
- L20: aborting the request cancels in-flight Lua work (`luaRuntime.test.ts`
  L20 block).
- L22: a delimiter-less stream is bounded (`openai.test.ts` SSE +
  `ollama.test.ts` NDJSON).
- L23: the previously-bypassing embedded-private IPv6 forms are blocked
  (`luaRuntime.test.ts` L23 block).
- L24: `setObjectValue` cannot pollute `Object.prototype`
  (`additionalParams.test.ts` payloads).
- L25: a blocked URL does not consume the egress budget (`luaRuntime.test.ts`
  L25 test).
- Gates `M6, M8, L20, L22, L23, L24, L25` registered as `DONE` in Phase 8.

## Validation

Recorded in [`../../../latest-verification.md`](../../../latest-verification.md):
server suite 1692/1 (+21), client suite 1121/4 (carried), audit green, both
TypeScript checks zero errors.
