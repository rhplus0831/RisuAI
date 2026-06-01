# Explicit Route Rate Limits

Status: implemented.

## Source Anchors

- `server/fastify/src/app.ts`
- `server/fastify/src/routes/auth.ts`
- `server/fastify/src/routes/proxy.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/routes/generationChat.ts`

## Scope

Add route-level limits for selected abuse-prone endpoints while preserving
long-lived protocol streams.

Implemented scope:

- Runtime source files: `server/fastify/src/routeRateLimits.ts`,
  `server/fastify/src/routes/auth.ts`, `server/fastify/src/routes/assets.ts`,
  `server/fastify/src/routes/generation.ts`,
  `server/fastify/src/routes/generationChat.ts`,
  `server/fastify/src/routes/legacyStorage.ts`,
  `server/fastify/src/routes/proxy.ts`,
  `server/fastify/src/routes/realmImport.ts`,
  `server/fastify/src/routes/save.ts`, and
  `server/fastify/src/routes/streamJobs.ts`.
- Protocol surface: public auth setup/login/crypto, authenticated proxy fetch,
  proxy stream-job create, `.risu` import, Realm character import, asset upload,
  bulk asset upload, generation completion, chat generation submit, and prompt
  preview submit now carry explicit `config.rateLimit` entries.
- Durable mutation/read behavior: no command, revision, event, projection, or
  persistence semantics changed; rate-limited requests stop before handlers.
- Rollback/resync behavior: unchanged because rejected requests do not enter
  durable mutation code paths.
- Exclusions: `/api/v1/events`,
  `/api/v1/generate/chat/:id/stream`, proxy stream deletion/attach, and
  WebSocket attach remain outside ordinary route request limits.

## Protocol Behavior

- Keep `@fastify/rate-limit` non-global unless the route inventory proves a
  safe default.
- Candidate endpoints include auth setup/login/crypto, proxy fetch/job create,
  generation submit, import, asset upload, and bulk asset upload.
- Exclude SSE, WebSocket, and attach routes from ordinary request-per-minute
  limits.

Implemented limits are named in `server/fastify/src/routeRateLimits.ts` so route
owners can tune individual surfaces without enabling a global throttle.

## Done When

- Selected routes have explicit limits with documented reasons.
- Tests cover at least one route limit and one intentional streaming exclusion.
- Normal login, events, generation, and proxy stream attach still work.

## Validation

- `pnpm api:test -- server/fastify/__tests__/routeProtection.test.ts`
- `pnpm api:test`
