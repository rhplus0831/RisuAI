# Direct Projection Write Fixes

Status: active priority.

## Source Anchors

- `src/ts/server/projectionWriteGuard.svelte.ts`
- `src/lib/Others/HypaV3Modal.svelte`
- `src/lib/Others/BookmarkList.svelte`
- `src/ts/server/commands.ts`

## Scope

Remove UI paths that mutate server-backed `DBState.db` directly before or
without dispatching a server command.

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

- Focused tests for changed UI or command helper behavior.
- `pnpm test -- src/ts/bootstrap.test.ts`
- `pnpm client-thinning:audit`
