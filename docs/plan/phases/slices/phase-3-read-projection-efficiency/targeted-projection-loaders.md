# Targeted Projection Loaders

Status: second batch implemented.

## Source Anchors

- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`
- `src/ts/server/projection.ts`
- `src/ts/bootstrap.ts`

## Scope

Avoid loading a full stub projection for targeted resources that can be served
from narrower loaders or that intentionally return no projected fields.

First implemented batch:

- Source files: `server/fastify/src/routes/projection.ts`,
  `server/fastify/__tests__/projection.test.ts`, `src/ts/bootstrap.test.ts`.
- Protocol surface: `GET /api/v1/projection/:resource` for command-event
  resources whose field list is known to be empty.
- Durable read path: keep `getSchemaState()` for the current revision, but do
  not read or parse `db.json` for empty-field resources such as `asset`.
- Revision/event behavior: preserve the existing `mode: "fields"` response and
  let the client advance its command-event cursor without merging fields.
- Rollback/resync behavior: unknown resources and broad resources still return
  `mode: "full"` and trigger the existing client bootstrap fallback.
- Proof commands passed:
  `pnpm api:test -- server/fastify/__tests__/projection.test.ts` and
  `pnpm test -- src/ts/bootstrap.test.ts`.

Second implemented batch:

- Source files: `server/fastify/src/routes/projection.ts`,
  `server/fastify/src/repository.ts`,
  `server/fastify/__tests__/projection.test.ts`.
- Protocol surface: `GET /api/v1/projection/:resource` for non-empty small
  resources whose fields do not require chat message stubbing or character
  lorebook stubbing.
- Durable read path: `preset`, `prompt`, `promptItem`, `persona`,
  `translatorPreset`, and `loadout` now select the requested top-level fields
  from the message-free persisted database and mask secrets on that narrowed
  field object.
- Revision/event behavior: preserve the existing `mode: "fields"` response,
  current revision reporting, and client cursor advancement behavior.
- Rollback/resync behavior: broad resources such as `character`, `chat`,
  `message`, `generation`, `lorebook`, `module`, `scriptDefinition`,
  `triggerDefinition`, and `plugin` keep the existing full stub projection
  path until their masking and stub semantics are scoped separately.
- Proof commands:
  `pnpm api:test -- server/fastify/__tests__/projection.test.ts` and
  `pnpm test -- src/ts/bootstrap.test.ts`.

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

Current result:

- Empty-field resources such as `asset` return `mode: "fields"` with an empty
  field map without loading `db.json`.
- Small non-empty resources (`preset`, `prompt`, `promptItem`, `persona`,
  `translatorPreset`, `loadout`) avoid the full stub projection path while
  preserving provider secret masking.
- Unknown resources still use the existing full-resync behavior.
- Broad non-empty resources that carry chat, module, plugin, or lorebook stub
  semantics remain future Phase 3 work and should be scoped separately before
  implementation.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
