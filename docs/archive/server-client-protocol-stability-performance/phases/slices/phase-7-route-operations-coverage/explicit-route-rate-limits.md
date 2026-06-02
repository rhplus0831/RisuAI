# Explicit Route Rate Limits

Status: implemented.

## Source Anchors

- `server/fastify/src/app.ts`
- `server/fastify/src/routeRateLimits.ts`
- `server/fastify/src/routes/auth.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/routes/generation.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/legacyStorage.ts`
- `server/fastify/src/routes/proxy.ts`
- `server/fastify/src/routes/realmImport.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/streamJobs.ts`

## Scope

Route-local `config.rateLimit` entries now protect selected buffered or
abuse-prone endpoints without enabling a global throttle.

Covered surfaces:

- Public auth setup/login/crypto helpers.
- Authenticated proxy fetch and proxy stream-job creation.
- `.risu` import, Realm character import, asset upload, and bulk asset upload.
- Generation completion, chat generation submit, and prompt preview submit.

Intentional exclusions:

- `/api/v1/events`
- `/api/v1/generate/chat/:id/stream`
- Proxy stream deletion/attach and WebSocket attach routes

## Protocol Behavior

- `@fastify/rate-limit` remains registered with `global: false`.
- Named limits live in `server/fastify/src/routeRateLimits.ts` so route owners
  can tune individual surfaces.
- Rate-limited requests stop before handlers, so command/revision/event,
  persistence, rollback, and resync semantics are unchanged.
- SSE, WebSocket, and attach routes stay outside ordinary request-per-minute
  limits.

## Done When

- Selected routes have explicit limits with documented reasons. Done.
- Tests cover at least one route limit and one intentional streaming exclusion.
  Done.
- Normal login, events, generation, and proxy stream attach still work. Done.

## Validation

- `pnpm api:test -- server/fastify/__tests__/routeProtection.test.ts`
- `pnpm api:test`
