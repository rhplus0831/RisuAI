# Server Route Coverage

## Goal

Server route coverage should prove that Fastify owns the supported API surface and that removed local or non-Fastify routes are no longer required by the client.

## Retained Routes

- `/api/v1/storage/*`
- `/api/v1/proxy/*`
- Fastify generation, chat, memory, command, and settings routes already owned by the server migration.
- Static asset serving for the built client.

## Removal Checks

- Legacy storage paths: `/api/write`, `/api/read`, `/api/list`, `/api/remove`; Phase 3A removed these from client storage selection in `src/ts/storage/nodeStorage.ts`.
- Local app persistence selection: Phase 3B removed OPFS/localforage as app-runtime storage alternatives in `src/ts/storage/autoStorage.ts`.
- Bootstrap local save-file fallback: Phase 3C removed local save-file initialization from `src/ts/bootstrap.ts`; unavailable or errored Fastify bootstrap data is now an explicit error.
- Legacy proxy paths: `/proxy2`, `/proxy-stream-jobs`; Phase 4 removed these from client proxy selection in `src/ts/globalApi.svelte.ts`.
- Hono adapters and Cloudflare/Vercel/Bun entry points.
- Hosted function proxy files under `public/functions`; Phase 4 deleted `public/functions/proxy.js` and `public/functions/proxy2.js`.

## Expected Coverage

- Route tests cover success and failure paths for retained Fastify APIs.
- Client integration or smoke coverage proves the built UI uses Fastify `/api/v1/*`.
- `src/ts/storage/nodeStorage.test.ts` covers retained Fastify storage and auth endpoints from the client storage adapter.
- `src/ts/storage/autoStorage.test.ts` covers retained Fastify app persistence selection through `NodeStorage`.
- `src/ts/bootstrap.test.ts` covers Fastify bootstrap projection loading and explicit bootstrap errors without local persistence fallback.
- `src/ts/globalApi.proxy.test.ts` covers retained Fastify proxy route selection from the client proxy helpers.
- Tests or static checks fail if package scripts point at removed server projects.

## Exit Criteria

- `pnpm api:test` passes without non-Fastify route dependencies.
- `pnpm smoke:fastify-browser` proves static client and Fastify APIs work together.
- Removed routes are listed in [../removed-and-out-of-scope.md](../removed-and-out-of-scope.md).
