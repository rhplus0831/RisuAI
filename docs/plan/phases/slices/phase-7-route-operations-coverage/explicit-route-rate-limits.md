# Explicit Route Rate Limits

Status: planned.

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

## Protocol Behavior

- Keep `@fastify/rate-limit` non-global unless the route inventory proves a
  safe default.
- Candidate endpoints include auth setup/login/crypto, proxy fetch/job create,
  generation submit, import, asset upload, and bulk asset upload.
- Exclude SSE, WebSocket, and attach routes from ordinary request-per-minute
  limits.

## Done When

- Selected routes have explicit limits with documented reasons.
- Tests cover at least one route limit and one intentional streaming exclusion.
- Normal login, events, generation, and proxy stream attach still work.

## Validation

- `pnpm api:test`
- Manual smoke for login, events, generation, and proxy stream attach.
