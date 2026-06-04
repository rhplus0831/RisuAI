# Outbound Request Lifecycle

Status: not started. Phase 4. Bundles the outbound-fetch timeout/abort fixes and
the egress hardening gaps.

## Scope

Add preventive wall-clock bounds and abort propagation to the proxy, non-durable
provider, and Lua fetch paths, and close the SSRF / prototype-pollution /
rate-counter gaps. Bounds must be generous enough not to abort slow-but-valid
local models.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  **M6, M8, L20, L22, L23, L24, L25**.
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

- [ ] **M6** — proxy `/fetch` aborts upstream on `req.raw` close via
      `AbortSignal.any([timeout.signal, closeSignal])`; remove the close listener
      in `finally`; add a generous Fastify `requestTimeout` backstop.
- [ ] **M8** — install a bounded deadline in `attachAbort` (mirror the durable
      600s `deadlineAt`) covering buffered + streaming non-durable paths and the
      standalone `routes/generation.ts` endpoints; add a body-size cap on buffered
      provider bodies.
- [ ] **L20** — thread the request `AbortSignal` into `runServerLua` (cooperate
      with the existing exec-limit hook) so disconnect cancels in-flight hook work.
- [ ] **L22** — cap the streaming-provider SSE accumulation buffer.
- [ ] **L23** — unwrap 6to4 / NAT64 / IPv4-compatible embedded addresses in
      `isBlockedV6` **[known-leftover: hosted-Lua]**.
- [ ] **L24** — reject dotted `__proto__`/`constructor`/`prototype` keys in
      `setObjectValue`.
- [ ] **L25** — increment the Lua egress rate counter only after
      `validateEgressUrl` passes.

## Behavior / Invariants

- Timeouts/caps change only the failure mode; a successful (even slow-but-valid
  local) generation is unaffected. Use the durable 600s default as the reference.
- L20's abort must terminate the wasmoon run, not just the surrounding fetch.
- Egress guards (L23/L24/L25) must not block currently-legitimate requests.

## Done Criteria

- M6: a disconnect mid-`/proxy/fetch` aborts the upstream; backstop timeout
  configured; no listener leak.
- M8: non-durable provider requests are bounded by a generous deadline + body cap;
  a generous-bound test confirms a slow valid model is not aborted.
- L20: aborting the request cancels in-flight Lua work.
- L22: a delimiter-less stream is bounded.
- L23: the previously-bypassing embedded-private IPv6 forms are blocked (test).
- L24: `setObjectValue` cannot pollute `Object.prototype` (test the payloads).
- L25: a blocked URL does not consume the egress budget.
- Gates `M6, M8, L20, L22, L23, L24, L25` registered in Phase 8.

## Validation

- `pnpm api:test -- server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/generation.test.ts`
- `pnpm api:test -- server/fastify/__tests__/luaRuntime*.test.ts` + a
  `setObjectValue` prototype-pollution unit test.
- `pnpm api:test`, both TypeScript checks.
