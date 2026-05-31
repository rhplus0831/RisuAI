# Bulk Chat And Lorebook Reads

Status: planned.

## Source Anchors

- `src/ts/server/chatMessageHydration.svelte.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/messageStore.ts`
- `src/ts/storage/risuSave.ts`

## Scope

Reduce the still-N-request shape of all-chat and all-lorebook readers. Hydration
is bounded, but export, dataset, branch-tree, and cold-storage workflows can
still require one request per unhydrated chat or character.

## Protocol Behavior

- Consider bulk chat-message and bulk lorebook hydration endpoints.
- Consider moving export or branch-tree assembly server-side when the workflow
  already requires all histories.
- Preserve active-chat hydration dedupe and stale-response behavior.

## Done When

- A selected all-history workflow has a lower request count path.
- Tests cover partial failures, stale revision handling, and hydration cache
  updates.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
