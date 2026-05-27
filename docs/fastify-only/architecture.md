# Fastify-Only Architecture

## Target Runtime

The target runtime has one supported production shape:

- Fastify owns API routes, storage, proxy, generation-related server IO, static asset serving, and Docker runtime startup.
- The built web client runs as Fastify-served static assets.
- Client code may know that it is server-backed, but it should not branch across local, node, Hono, hosted functions, native shells, or standalone browser persistence modes.

## Server Layout

The Fastify server remains under `server/fastify`.

Expected owned surfaces:

- App construction and plugin registration.
- `/api/v1/*` route contracts.
- Static root serving.
- Data directory ownership.
- Auth and storage gates.
- Proxy and provider relay behavior.
- Smoke-test startup.

Removal state:

- Phase 1 removed `server/hono`, its Node, Bun, Cloudflare, and Vercel adapters, and legacy root launchers.
- Phase 4 removed hosted function proxies under `public/functions`.

## Client Contract

The client should assume a Fastify-served runtime.

- `globalThis.__FASTIFY__` is the single Fastify-served client signal.
- `src/ts/platform.ts` exports `isFastifyServer` plus browser/device helpers. It no longer exports `isNodeServer`, `isTauri`, or `isWeb`.
- Test/dev harnesses may explicitly mock `isFastifyServer`; production code should not model removed runtime families.

## API Surface

The retained API surface should use `/api/v1/*`.

- Storage uses `/api/v1/storage/*`.
- Proxy uses `/api/v1/proxy/*`.
- Generation and chat server routes stay under the Fastify route tree.
- Legacy paths such as `/api/write`, `/api/read`, `/api/list`, `/api/remove`, `/proxy2`, and `/proxy-stream-jobs` are removed from client selection.

## Persistence

Fastify owns persisted application data through the configured server data directory.

The target design removes standalone browser persistence as a supported mode. OPFS, localforage, browser save-file bootstrap, and local-only import/export flows may remain only if they are explicitly part of a Fastify-served workflow rather than a replacement runtime.

## Boundary Rules

- No production import should depend on Hono, Electron, Capacitor, Cloudflare Pages Functions, Bun adapters, or Vercel adapters.
- No UI branch should imply a supported local-only runtime.
- No package script should advertise a removed platform.
- No README or smoke instruction should point users at a non-Fastify server.

## References

- `server/fastify/src/app.ts:176`
- `src/ts/platform.ts:13`
- `src/ts/storage/nodeStorage.ts:6`
- `src/ts/globalApi.svelte.ts:560`
- `src/ts/globalApi.proxy.test.ts:80`
