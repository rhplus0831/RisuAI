# Slice: Vertex Token Inflight Dedupe

Phase: [8](../../phase-8-server-bounds.md). Finding: L30. Runtime change.

## Scope

Dedupe concurrent cold Vertex bearer-token exchanges so simultaneous Gemini
requests share one in-flight token promise.

This slice does not own Gemini request routing, token exchange payload
semantics, provider retries, or persisted provider settings.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L30.
- `server/fastify/src/generation/vertexAuth.ts`: token cache key, JWT signing,
  exchange request, cache expiry, and test reset helper.
- `server/fastify/src/generation/gemini.ts`: Vertex caller if the auth API
  signature needs to change.
- Existing focused suites:
  `server/fastify/__tests__/vertexAuth.test.ts`,
  `server/fastify/__tests__/gemini.test.ts`, and
  `server/fastify/__tests__/generation.completion.test.ts`.

## Target Shape

- Store an in-flight promise per Vertex token cache key before starting the JWT
  signing/token-exchange work.
- Return the same promise to concurrent callers with identical credentials and
  scope/region/project.
- Populate the normal token cache on success, then clear the in-flight entry.
- Clear the in-flight entry on failure so the next caller can retry.
- Keep separate credentials or scopes isolated; they must not share a token
  promise.
- Update `_resetVertexTokenCacheForTesting` to clear both cached tokens and
  in-flight promises.
- Add tests proving concurrent cold callers perform one exchange, warm callers
  use the token cache, failed exchanges are not permanently cached, and distinct
  credentials do not dedupe together.
- Register L30 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Bearer token contents, expiry skew, JWT claims, and exchange endpoint remain
  unchanged.
- A failed token exchange surfaces the same error to all waiters.
- Token cache expiry still controls when a new exchange is needed.
- Concurrent callers must not receive a token for the wrong Vertex settings.

## Done Criteria

- Concurrent cold Vertex auth calls share one JWT signing/token exchange.
- Success populates the existing token cache; failure clears the in-flight
  promise.
- The L30 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Proof Details

- Runtime proof: `server/fastify/src/generation/vertexAuth.ts` stores cached
  tokens and in-flight token requests under the service-account email, fixed
  cloud-platform scope, and private-key fingerprint; identical cold callers
  share the in-flight exchange while distinct private keys remain isolated.
- Failure proof: token-exchange failures resolve to the same result for all
  waiters and the in-flight entry is cleared so a later caller can retry.
- Regression proofs:
  `server/fastify/__tests__/vertexAuth.test.ts` covers concurrent cold
  dedupe, warm cache reuse, failed in-flight retry, distinct-key isolation, and
  safety-margin expiry refresh under `L30:` test names.
- Gate proof: `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L30 as
  `DONE`;
  `.archived-docs/performance-and-stability/stability-audits/v2/active-risk-analysis.md`
  marks L30 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/vertexAuth.test.ts \
  server/fastify/__tests__/gemini.test.ts \
  server/fastify/__tests__/generation.completion.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
