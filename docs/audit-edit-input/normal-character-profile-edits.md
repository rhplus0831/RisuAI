# Character Profile Edits Audit

Date: 2026-06-16

Status: normal

## Scope

Verified Fastify-backed character profile edits from the character config UI:
description, first message, background HTML, personality/scenario, alternate
greetings, additional assets, and adjacent scalar/nested profile fields.

## Result

Profile edits work correctly. The editor uses a server-backed character draft,
excludes command-owned collections such as `chats`, and sends profile fields
through the character PATCH path.

## Evidence

- `src/lib/SideBars/CharConfig.svelte:87` seeds the editable profile draft field
  list.
- `src/lib/SideBars/CharConfig.svelte:509` and nearby bindings mutate the draft
  fields.
- `src/ts/server/characterBridge.svelte.ts:148`, `:255`, and `:280` diff
  profile fields and dispatch sanitized patches.
- `src/ts/characterCommands.ts:47` excludes command-owned fields such as
  `chats`, `globalLore`, `customscript`, and `triggerscript`.
- `server/fastify/__tests__/commands.test.ts:3441` and `:3458` cover server
  character PATCH persistence for normal profile fields.

## Verification

Targeted character bridge, command, projection, and recent-regression tests
passed:

- `pnpm exec vitest run src/ts/server/characterBridge.svelte.test.ts`
- `pnpm exec vitest run src/ts/characterCommands.test.ts`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandSingleRowPaths.test.ts server/fastify/__tests__/projection.test.ts`

Residual coverage gap: add a mounted character config test that edits several
profile fields and asserts the queued PATCH body, but no current failure was
found in this slice.
