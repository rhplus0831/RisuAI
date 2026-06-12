# Per-Generation Asset Cache

Status: completed on 2026-06-01.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/`
- `src/ts/globalApi.svelte.ts`
- `server/fastify/src/repository.ts`

## Scope

Avoid repeated file reads and base64 encodes when the same stored asset is
referenced multiple times during one generation request.

Active implementation scope:

- Source files: `server/fastify/src/routes/generationChat.ts`,
  `server/fastify/__tests__/generation.chat.test.ts`, and this plan slice.
- Protocol surface: no route, request, response, SSE frame, provider payload, or
  route-manifest shape changes.
- Durable mutation/read path: read-only request-scoped cache around stored asset
  resolution for `/api/v1/generate/chat` and `/api/v1/generate/preview-prompt`;
  inline, durable, and preview assembly each receive a fresh cache.
- Revision/event behavior: unchanged; asset reads do not bump revision or emit
  command events.
- Rollback/resync behavior: none required because the cache is in-memory and
  discarded when the assembly call finishes.
- Proof command: `pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`.

## Result

`server/fastify/src/routes/generationChat.ts` now builds one stored-asset
resolver per prompt assembly call. The resolver normalizes bare SHA-256 ids and
`assets/<id>.<ext>` references to the same cache key, separates entries by
`asset_prompt` versus `inlay` purpose, caches missing assets for that request,
and returns cloned multimodal records so downstream formatting keeps the prior
fresh-object behavior.

The cache is read-only and request-scoped. Inline chat generation, durable chat
generation, and preview-prompt assembly each construct a fresh resolver through
their existing `loadDatabaseDeps()` path.

## Protocol Behavior

- Key cache entries by asset id and purpose within a single generation request.
- Preserve provider wire compatibility, including base64 where required.
- Do not persist cached bytes beyond request lifetime.

## Done When

- Repeated references to one stored asset in a generation do not re-read and
  re-encode the asset.
- Provider request shape remains unchanged.
- Asset id and missing-asset error behavior remain unchanged.

## Validation

- Focused generation asset-resolution tests in
  `server/fastify/__tests__/generation.chat.test.ts`.
- `pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`
