# Message And Chat Targeted Persistence

Status: planned.

## Source Anchors

- `server/fastify/src/messageStore.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/routes/commands.ts`

## Scope

Evaluate targeted helpers for message append/edit and chat metadata updates so
they can update message rows or message-free `db.json` without scanning every
chat.

## Protocol Behavior

- Keep complex mutations on the generic path until targeted row ownership is
  proven.
- Preserve reroll alternates and `hypaV3Data` split-store semantics.
- Do not emit more than one event for one revision bump.

## Done When

- A targeted chat/message family is selected with explicit row ownership.
- Tests prove unchanged conflict and projection refresh behavior.
- Metrics show the path avoids full chat diff scans.

## Validation

- Focused command tests for selected message or chat family.
- `pnpm api:test`
