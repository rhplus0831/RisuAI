# Server Route Coverage

## Goal

Server route coverage should prove that Fastify owns the supported API surface and that removed local or non-Fastify routes are no longer required by the client.

## Retained Routes

- `/api/v1/storage/*`
- `/api/v1/proxy/*`
- Fastify generation, chat, memory, command, and settings routes already owned by the server migration.
- Static asset serving for the built client.

## Removal Checks

- Legacy storage paths: `/api/write`, `/api/read`, `/api/list`, `/api/remove`.
- Legacy proxy paths: `/proxy2`, `/proxy-stream-jobs`.
- Hono adapters and Cloudflare/Vercel/Bun entry points.
- Hosted function proxy files under `public/functions`.

## Expected Coverage

- Route tests cover success and failure paths for retained Fastify APIs.
- Client integration or smoke coverage proves the built UI uses Fastify `/api/v1/*`.
- Tests or static checks fail if package scripts point at removed server projects.

## Exit Criteria

- `pnpm api:test` passes without non-Fastify route dependencies.
- `pnpm smoke:fastify-browser` proves static client and Fastify APIs work together.
- Removed routes are listed in [../removed-and-out-of-scope.md](../removed-and-out-of-scope.md).
