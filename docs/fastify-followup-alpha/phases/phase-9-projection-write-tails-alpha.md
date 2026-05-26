# Phase 9 Alpha 9B - Projection-Write Tails

Date: 2026-05-27

Status: open.

## Goal

Close the remaining Phase 9 client-thinning tails where reachable
Fastify-served web or browser MCP flows still mutate `DBState.db` or
projection aliases before command dispatch.

Phase 9A remains closed: module settings, `SideChatList`, Hypa/supa
memory toggles, and global lorebook page selection now use the intended
command-first or draft-first paths. This follow-up is for additional
surfaces found by the broader Phase 9 completion re-audit.

## Audit Finding

The 2026-05-27 re-audit confirmed that the projection guard still makes
untrusted Fastify projection writes fail, while `canUseServerCommands()`
is true in Fastify mode. Several command-backed flows still snapshot
state, mutate a projected object, and only then dispatch a command.

Source evidence to refresh before editing:

- Character create/import paths still mutate character arrays before
  dispatching character commands:
  `src/ts/characters.ts`,
  `src/ts/characterCards.ts`.
- Chat import paths still mutate selected-character chat and folder
  aliases before dispatching chat and chat-folder commands:
  `src/ts/characters.ts`.
- Module file/import paths still mutate module arrays before dispatching
  module commands:
  `src/ts/process/modules.ts`,
  `src/ts/characterCards.ts`.
- Module apply still mutates the selected character's lore/script/trigger
  child collections before dispatching through generic character update
  helpers, even though those child collections are command-owned by
  lorebook/script/trigger replacement commands:
  `src/ts/process/modules.ts`,
  `src/ts/characterCommands.ts`.
- Character order, character-folder metadata, and chat-page selection
  helpers still mutate projected state before dispatching reorder or
  selection commands:
  `src/lib/SideBars/Sidebar.svelte`,
  `src/ts/globalApi.svelte.ts`.
- Browser MCP `risuaccess` character/module writers still mutate
  character/module lorebook, script, trigger, and enablement aliases
  before dispatching the existing replacement or module commands:
  `src/ts/process/mcp/risuaccess/characters.ts`,
  `src/ts/process/mcp/risuaccess/modules.ts`.
- The focused 9J direct-bind sweep is still clean, and Phase 9A command
  tests pass, but the current verification does not directly cover
  `SideChatList`/`chatCommands.ts`, `deleteGlobalModule`, the import
  helpers above, or the MCP `risuaccess` paths under the projection
  guard.

## Tasks

- Convert the listed import, ordering, selection, module-apply, and MCP
  writers to command-first, draft-first, or explicitly trusted
  optimistic projection writes. Unsupported Fastify-web operations
  should be gated deliberately instead of reaching an accidental guard
  failure.
- Prefer the existing character, chat, module, lorebook, script
  definition, and trigger command surfaces. Add a command only if the
  current command surface cannot express an already-supported durable
  Fastify-web workflow.
- Add focused guard-enabled coverage for the fixed helpers, including
  at least one representative character import/create path, module
  import/create path, chat import path, character reorder/folder path,
  chat-page selection path, module-apply path, and MCP
  character/module child replacement path.
- Add missing helper coverage for the Phase 9A surfaces that are only
  indirectly covered today: `chatCommands.ts` flows used by
  `SideChatList`, plus `deleteGlobalModule`.
- Update stale unsupported-mode copy in the touched MCP paths so it no
  longer says a completed Phase 9 command slice has not landed.

## Boundaries

- Do not reopen Phase 9A implementation surfaces that already match the
  completed 9A checklist unless a focused guard test proves a regression.
- Keep Tauri/local-only direct writes local. This slice is about
  Fastify-served web and browser MCP paths.
- Do not broaden this into server-side command route redesign,
  event-patching optimization, provider work, or storage migration work.
- Do not add compatibility migrations for intermediate Fastify shapes.
- Do not turn this doc into a landed-work log. Move closeout detail to
  `../phases-completed/` after the slice closes.

## Exit Criteria

- The listed Fastify-web import, ordering, selection, module-apply, and
  MCP flows no longer perform untrusted projection writes before command
  dispatch.
- Focused guard-enabled helper tests fail on the pre-fix behavior and
  pass after the fix.
- The Phase 9 direct-bind sweep remains clean.
- Focused Phase 9 client and Fastify command suites pass.
- `pnpm smoke:fastify-browser` is rerun before closing this browser
  projection sweep.

## Verification

```bash
rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/moduleCommands.test.ts src/ts/characterCommands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
```

Add any new focused helper test files to the `pnpm exec vitest run ...`
command before closing the slice.

## Verification From Audit

The 2026-05-27 completion re-audit ran:

- `rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts`:
  no direct-bind hits.
- `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/moduleCommands.test.ts src/ts/characterCommands.test.ts`:
  passed, 4 files and 49 tests.
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/bootstrap.test.ts`:
  passed, 68 files and 1212 tests.

The audit did not rerun `pnpm smoke:fastify-browser`.
