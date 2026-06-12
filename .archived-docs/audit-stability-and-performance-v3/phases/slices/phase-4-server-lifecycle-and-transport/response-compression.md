# Slice: Response Compression

Phase: [4](../../phase-4-server-lifecycle-and-transport.md). Finding: L19.
HTTP transport performance change.

## Scope

Enable response compression for large API and static responses, default on,
with a sane threshold. Bootstrap JSON and static bundle responses should
negotiate gzip when the client sends `Accept-Encoding: gzip`, while
decompressed bodies remain byte-identical.

This slice owns HTTP response encoding only. It does not change bootstrap
projection shape, command payloads, static file contents, cache headers, or
application-level streaming protocols.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L19.
- `server/fastify/src/app.ts`: Fastify plugin registrations in `buildApp()`.
- `server/fastify/src/routes/bootstrap.ts`: large bootstrap JSON response.
- `server/fastify/__tests__/bootstrap.test.ts`: bootstrap response fixtures.
- `server/fastify/__tests__/static.test.ts`: static file serving harness.
- `package.json` and `pnpm-lock.yaml`: add `@fastify/compress` if using the
  plugin path.
- `docs/plan/active-risk-analysis.md` and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` for L19 proof
  registration.

## Target Shape

- Prefer registering `@fastify/compress` near the other global Fastify plugins
  with a threshold around 1 KiB.
- If the plugin is unsuitable, add a narrow `onSend` gzip hook with equivalent
  behavior and tests.
- Compression is default ON. If a deployment config gate is introduced, the
  default config path must still enable compression.
- Do not compress responses that should remain untransformed, especially SSE
  streams and other already-streaming protocol responses.
- Add tests that:
  request bootstrap with `Accept-Encoding: gzip`,
  assert `Content-Encoding: gzip`,
  decompress and compare the body to the uncompressed response,
  assert a small response below the threshold remains uncompressed, and
  cover at least one static asset or document why the plugin-level proof is
  sufficient.
- Record a size-ratio assertion or measured note for a corpus-sized bootstrap
  fixture when practical; avoid brittle exact byte numbers.
- Register L19 as `DONE` in the v3 gate and flip only the L19 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Clients that do not advertise gzip receive the same uncompressed response
  bodies as before.
- Decompressed compressed bodies are byte-identical to the uncompressed bodies.
- Existing `content-type`, auth, and status-code behavior does not change.
- SSE routes remain usable and are not buffered into one compressed response.
- Compression timers or streams do not interfere with shutdown close behavior.

## Done Criteria

- Large bootstrap JSON negotiates gzip and decompresses to the original JSON.
- Small responses below the threshold are not compressed.
- Static bundle responses negotiate gzip where supported by the chosen
  implementation.
- SSE/protocol streams remain uncompressed or explicitly excluded.
- L19 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bootstrap.test.ts \
  server/fastify/__tests__/static.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/realmImport.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
