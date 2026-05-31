# Per-Generation Asset Cache

Status: planned.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/`
- `src/ts/globalApi.svelte.ts`
- `server/fastify/src/repository.ts`

## Scope

Avoid repeated file reads and base64 encodes when the same stored asset is
referenced multiple times during one generation request.

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

- Focused generation asset-resolution tests.
- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
