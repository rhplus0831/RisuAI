# Expanded Import Size Limits

Status: planned.

## Source Anchors

- `server/fastify/src/app.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/risuSave/`
- `server/fastify/src/routes/realmImport.ts`

## Scope

Add post-inflate or expanded-size limits for import paths that currently buffer
compressed uploads and can decompress into much larger payloads.

## Protocol Behavior

- Preserve existing compressed upload limits.
- Reject expanded payloads with clear errors before committing partial durable
  state.
- Keep import conflict and active-writer behavior unchanged.

## Done When

- `.risu` and relevant Realm import paths enforce expanded-size limits or
  document why a route is already bounded.
- Tests cover oversized expanded payload rejection.

## Validation

- `pnpm api:test -- server/fastify/__tests__/save.test.ts`
- `pnpm api:test -- server/fastify/__tests__/realmImport.test.ts`
