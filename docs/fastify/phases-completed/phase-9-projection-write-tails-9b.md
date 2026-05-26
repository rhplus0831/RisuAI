# Phase 9B Projection-Write Tails

Date: 2026-05-27

Status: closed.

## Summary

Closed the remaining Phase 9 projection-write tails found by the alpha
re-audit. Fastify-served web and browser MCP flows now avoid untrusted
projection writes before command dispatch for the covered character,
chat, module, ordering, selection, module-apply, and MCP paths.

## Landed Scope

- Character creation and card/off-spec import paths now wrap optimistic
  character insertion in trusted projection writes before dispatching
  create-character commands.
- Chat import paths now wrap optimistic chat/folder insertion in trusted
  projection writes before dispatching chat and chat-folder commands.
- Module JSON/import helpers now route through `createGlobalModule`;
  asset-backed `.risum` imports remain explicitly unsupported in
  server-backed web mode until a server asset import command exists.
- Module apply now updates character lorebook, regex, and trigger child
  collections through the lorebook and script-definition replacement
  bridges instead of relying on generic character updates.
- Character ordering, folder metadata edits, `checkCharOrder`, and
  `changeChatTo` now perform deliberate trusted optimistic projection
  writes before the relevant reorder or selection command dispatch.
- Browser MCP `risuaccess` character/module info, lorebook, regex, and
  Lua writers now build command payloads from drafts in Fastify mode
  instead of mutating projected aliases first. Stale unsupported-mode
  copy was updated for remaining asset reference edits.
- Added guard-enabled helper coverage for chat command flows,
  `deleteGlobalModule`, character create, chat import, module import,
  module apply, and MCP character/module child replacement paths.

## Verification

```bash
rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/moduleCommands.test.ts src/ts/characterCommands.test.ts src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts src/ts/characters.importChat.test.ts src/ts/process/modules.test.ts src/ts/process/mcp/risuaccess/tests/modules.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
pnpm check
```

Results:

- Direct-bind sweep: no hits.
- Focused client/helper suites: 9 files, 73 tests passed.
- Focused Fastify API command/event/bootstrap suite: 68 files, 1217
  tests passed.
- Browser smoke: 1 test passed.
- At this slice closeout (`cf830b9e`), `pnpm check` still failed with
  the broad alpha typecheck blocker: 57 errors, 0 warnings, 17 files.

## Current Status

Phase 9 projection-write tails are closed for this alpha pass. Phase 5
boundary drift closed in `bd7a4712`, and the broad typecheck blocker
closed in `50d55b97`; current alpha status lives in
[`../status.md`](../status.md).
