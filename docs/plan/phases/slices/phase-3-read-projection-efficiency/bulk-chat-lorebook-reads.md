# Bulk Chat And Lorebook Reads

Status: chat batch implemented; lorebook batch planned only if measured.

## Source Anchors

- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/routeManifest.ts`
- `src/ts/server/projection.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`

## Scope

Reduce the request count for workflows that need many hydrated entities. Chat
hydration now has a bulk path; optional character lorebook hydration remains
bounded N-request fanout when `enableLorebookStubs` is enabled.

## Current Behavior

- `POST /api/v1/projection/chatMessages/bulk` is authenticated and read-only;
  the route manifest classifies it as `read-only-post`.
- `ensureAllChatsHydrated()` sends one bulk request for unhydrated,
  non-in-flight chat ids. Active-chat and explicit single-chat hydration still
  use `GET /api/v1/projection/chatMessages?id=...`.
- The bulk response carries one revision, per-chat
  messages/Hypa V3/alternates, and a `missing` list. The client drops stale
  responses before marking any chat hydrated.
- The server reads message, Hypa V3, and alternate rows from SQLite for the
  requested ids, with one message-free `db.json` pass for known-chat detection
  and defensive embedded-message fallback.

## Remaining Work

- Add a bulk character-lorebook path only if experimental
  `enableLorebookStubs` workflows become active enough to justify it.
- Consider server-side export or branch-tree assembly if all-history workflows
  still dominate after bulk chat hydration.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/routeProtection.test.ts`
- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
- `pnpm client-thinning:audit`
