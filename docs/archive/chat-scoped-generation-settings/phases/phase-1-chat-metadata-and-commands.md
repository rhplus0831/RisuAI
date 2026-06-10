# Phase 1: Chat Metadata & Commands

Status: complete.

Goal: persist, validate, project, and reconcile chat-owned generation settings
without changing prompt assembly yet.

## Completion Note

Closed after `adb21a849` and `9cbd388f3`. The server landed the dedicated
chat generation settings command, create-time validation, single-chat row writes,
and stored-value repair; the client landed the matching command wrapper,
optimistic one-chat rollback, and generic patch exclusion for
`generationSettings`. Prompt assembly, send gating, UI controls, and import or
fork/delete lifecycle behavior are intentionally left to later phases.

## Scope

- Add the chat generation settings type to the client and server chat model.
- Add the new fields to client and server chat patch allowlists or add a
  dedicated chat-generation-settings command if that fits the command style
  better.
- Validate `personaId` against `personas`, `presetId` against `botPresets`,
  `jailbreakToggle` presence/type, and sidebar toggle payload shape.
- Store settings in the chat row `data_json`; no SQLite schema migration is
  expected.
- Project and reconcile the settings with chat row updates.
- Normalize malformed settings to incomplete during chat repair/defaulting.

## Anchors

- `src/ts/storage/database.svelte.ts`
- `src/ts/chatCommands.ts`
- `src/ts/server/commands.ts`
- `server/fastify/src/commands/chats.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/databaseDefaults.ts`
- `server/fastify/src/routeManifest.ts`

## Target Shape

- Chat create and patch paths can write the settings object by chat id.
- The command writes one chat row, bumps one revision, and emits the expected
  projection event.
- Invalid settings fail without partial writes.
- Failed commands roll back only the touched chat row.
- Global persona/preset selection commands remain available for editing state
  but do not change any chat generation settings.

## Invariants

- Sibling chats and sibling characters are not rewritten by a settings patch.
- Projection includes the chat settings as part of the chat row.
- Old saves load without crashing and show incomplete chat settings.
- A chat without the settings object is incomplete.

## Exit Criteria

- Chat settings can be created, patched, projected, repaired, and reconciled by
  chat id.
- Client and server type definitions agree.
- Tests cover invalid persona, invalid preset, malformed toggle map, explicit
  off values, stale keys, and narrow rollback behavior.
- Route manifest/auth/active-writer decisions are updated if a new route is
  added.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandSingleRowPaths.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- Existing chat patch helpers may accept partial metadata too broadly. Prefer a
  focused validator for generation settings so malformed values cannot enter
  chat rows through generic patching.
- Existing defaults may auto-select persona or preset. This phase must keep
  those defaults out of chat readiness.
