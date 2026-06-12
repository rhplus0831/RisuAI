# Direct Projection Write Fixes

Status: implemented.

## Source Anchors

- `src/ts/server/projectionWriteGuard.svelte.ts`
- `src/lib/Others/HypaV3Modal.svelte`
- `src/lib/Others/BookmarkList.svelte`
- `src/ts/server/commands.ts`

## Scope

Remove UI paths that mutate server-backed `DBState.db` directly before or
without dispatching a server command.

Implemented scope:

- `src/lib/Others/HypaV3Modal.svelte` now uses a local default Hypa V3 data
  view when server-backed memory has no hydrated legacy blob. It initializes
  `chat.hypaV3Data` only outside server-backed memory mode.
- Hypa V3 reset and bulk mutation handlers return early in server-backed memory
  mode, matching the read-only UI state for server memory.
- `src/lib/Others/BookmarkList.svelte` now builds cloned `bookmarks` and
  `bookmarkNames` patches in Fastify command mode, then dispatches
  `updateChat` without first mutating guarded chat fields.
- Local non-command bookmark flows keep their local mutation behavior.
- `src/lib/Others/projectionGuard.test.ts` covers Hypa V3 modal mount and
  bookmark rename/remove interactions with the server projection guard enabled.

## Protocol Behavior

- Build patched copies or local drafts before dispatching command-backed
  mutations.
- Use trusted projection scopes only in established server projection and
  optimistic command helper paths.
- Preserve rollback behavior for failed or conflicted commands.

## Done When

- Hypa V3 modal initialization no longer assigns directly into guarded chat
  state in server mode.
- Bookmark add/remove/rename flows do not mutate guarded chat fields before the
  command path owns the change.
- Projection guard tests or component tests cover both paths.

## Validation

- `pnpm test -- src/lib/Others/projectionGuard.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts`
- `pnpm client-thinning:audit`
