# Bulk Chat And Lorebook Reads

Status: implemented on 2026-06-02.

## Source Anchors

- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/routeManifest.ts`
- `src/ts/server/projection.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`

## Scope

Reduce the request count for workflows that need many hydrated entities. Chat
hydration and optional character lorebook hydration both have bulk paths for
all-history/all-lore workflows.

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
- `POST /api/v1/projection/characterLorebooks/bulk` is authenticated and
  read-only; the route manifest classifies it as `read-only-post`.
- `ensureAllCharacterLorebooksHydrated()` sends one bulk request for unhydrated,
  non-in-flight character ids when experimental `enableLorebookStubs` is on.
  Active-character hydration still uses
  `GET /api/v1/projection/characterLorebook?id=...`.
- The bulk lorebook response carries one revision, per-character `globalLore`,
  and a `missing` list. The client drops stale responses before marking any
  character lorebook hydrated.
- The server reads the full un-stubbed repository once for requested character
  ids, returns `globalLore: []` for known lore-less characters, and reports
  unknown character ids as missing.

## Remaining Work

- Consider server-side export or branch-tree assembly if all-history workflows
  still dominate after bulk chat and lorebook hydration.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/routeProtection.test.ts`
- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
- `pnpm client-thinning:audit`
