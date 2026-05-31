# Server-Owned Revision Bump Audit

Status: planned.

## Source Anchors

- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/backups.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/commands/events.ts`

## Scope

Inventory revision bumps outside the normal JSON command helper and prove each
one has a matching persisted command event or a documented live-only/non-domain
exception.

## Protocol Behavior

- Preserve one replayable command event for every revision-tracked projected
  mutation.
- Explicitly document exceptions such as live-only export notifications or
  non-domain memory progress events.
- Connect this audit to asset, import, restore, and generation persistence
  durability work.

## Done When

- All non-`applyJsonCommandMutation()` revision bumps are listed.
- Each listed path has tests or documentation for event persistence and live
  fanout behavior.
- Missing replay records become tracked implementation slices.

## Validation

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test`
