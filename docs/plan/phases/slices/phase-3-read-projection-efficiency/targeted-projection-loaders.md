# Targeted Projection Loaders

Status: planned.

## Source Anchors

- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`
- `src/ts/server/projection.ts`
- `src/ts/bootstrap.ts`

## Scope

Avoid loading a full stub projection for targeted resources that can be served
from narrower loaders or that intentionally return no projected fields.

## Protocol Behavior

- Keep the existing projection response contract unless a phase explicitly
  changes it.
- Short-circuit empty resources such as asset invalidations before full
  projection load.
- Add field-specific loaders only when they can preserve secret masking and
  message-light projection semantics.

## Done When

- Empty or small projection resources avoid full `loadStubProjection()` cost.
- Unknown or broad resources still fall back to existing full behavior.
- Tests cover narrow and fallback paths.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
