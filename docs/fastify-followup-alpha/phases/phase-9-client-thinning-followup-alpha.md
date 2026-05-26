# Phase 9 Alpha Follow-Up - Client Thinning

Date: 2026-05-27

Status: reopened by alpha audit.

## Goal

Fastify-served web must remain a server projection. Durable browser
mutations should go through typed commands, import/export routes, or
documented server-owned APIs. Direct projection writes should fail
unless they are trusted projection refresh, rollback, or command replay.

## Audit Finding

The projection guard is enabled after Fastify bootstrap, but reachable
UI paths still mutate `DBState.db` or aliases before command dispatch.
These paths either throw before dispatch in Fastify mode or become
projection-only writes that are lost on refresh.

Guard surfaces:

- Guard enabled after Fastify bootstrap:
  `src/ts/bootstrap.ts:214`
- Direct projection write trap:
  `src/ts/server/projectionWriteGuard.svelte.ts:68`

Representative blockers:

- Module settings mutate enabled modules/modules before dispatch:
  `src/lib/Setting/Pages/Module/ModuleSettings.svelte:100`,
  `src/lib/Setting/Pages/Module/ModuleSettings.svelte:150`,
  `src/lib/Setting/Pages/Module/ModuleSettings.svelte:218`
- `SideChatList` receives bound character projection aliases from:
  `src/lib/SideBars/Sidebar.svelte:945`,
  `src/lib/SideBars/Sidebar.svelte:985`,
  `src/lib/Mobile/MobileBody.svelte:53`
- `SideChatList` mutates chats/folders before command dispatch:
  `src/lib/SideBars/SideChatList.svelte:193`,
  `src/lib/SideBars/SideChatList.svelte:216`,
  `src/lib/SideBars/SideChatList.svelte:526`,
  `src/lib/SideBars/SideChatList.svelte:619`,
  `src/lib/SideBars/SideChatList.svelte:695`
- Direct folder-name binding writes through a projection alias:
  `src/lib/SideBars/SideChatList.svelte:236`
- Hypa/supa memory toggles bind directly to character fields:
  `src/lib/SideBars/Toggles.svelte:178`,
  `src/lib/SideBars/Toggles.svelte:193`
- `loreBookPage` selection uses a trusted projection write without a
  command even though the command map assigns it to lorebook work:
  `src/lib/Setting/lorepreset.svelte:27`

## Tasks

- Convert module settings create/edit/delete/global enablement flows to
  command-first or draft-state-first behavior that does not mutate
  `DBState.db` before dispatch.
- Convert `SideChatList` chat/folder create, fork/copy, delete, fold,
  and rename flows away from projection alias mutation before dispatch.
- Route Hypa/supa memory toggles through the appropriate character
  command or classify them as non-durable with tests and docs.
- Decide whether `loreBookPage` is durable. If durable, route it through
  a command; if UI-local, update the command map and remove the trusted
  durable-looking write.
- Add focused tests that run with projection guard enabled and exercise
  the affected workflows or their command bridges.

## Exit Criteria

- No reachable durable Fastify web workflow mutates `DBState.db` or a
  projection alias before dispatching the server command that owns the
  mutation.
- Trusted projection writes remain limited to bootstrap/projection
  refresh, command replay, rollback, import/export sync, or documented
  local-only state.
- `pnpm smoke:fastify-browser` still passes and covers guard
  enforcement after these workflows are adjusted.

## Verification

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/moduleCommands.test.ts src/ts/characterCommands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
pnpm check
```

## Search Hints

The final direct-bind sweep in the previous follow-up missed alias-based
writes. Do not rely only on `bind:value={DBState.db...}` style greps.
Also inspect bound props such as `bind:chara`, local aliases derived
from `DBState.db`, and mutation helpers that change arrays before
dispatching commands.

Useful starting searches:

```bash
rg -n "bind:chara|bind:value=\\{chara|bind:check=\\{chara|chara\\.chats|chara\\.chatFolders|enabledModules|loreBookPage" src/lib src/ts
rg -n "DBState\\.db\\.(characters|modules|enabledModules|loreBook|loreBookPage)" src/lib src/ts
```

## References

- Original phase: `docs/fastify/phases/phase-9-client-thinning.md`
- Original command map:
  `docs/fastify/status/phase-9-command-map.md`
- Completed follow-up: `docs/fastify-followup/phases/phase-9-client-thinning-followup.md`
