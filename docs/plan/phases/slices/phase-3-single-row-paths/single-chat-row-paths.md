# Single Chat-Row Paths

Status: implemented (`fastify`: stage b `90c6df95`). Tier 3. All three routes
report `targeted-chat-row` and write one `UPDATE chats` via `writeSingleChatRow`:
scriptstate (the hot path — no longer hydrates messages or rewrites every
character), chats/:id (+ the parent character row only when `select:true` moves
`chatPage`), and chats/:id/lorebooks (`localLore`).

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 3 "Single chat row".
- `server/fastify/src/routes/commands.ts` - scriptstate, chats/:id PATCH, and
  chats/:id/lorebooks.
- `server/fastify/src/repository.ts` - `writeSingleChatRow`.

## Scope

The change is one chat row (`scriptstate` and `localLore` live in
`chats.data_json`). Narrow each to `UPDATE chats WHERE id=?`.

| Route | Desired write | Notes |
| --- | --- | --- |
| `PATCH chats/:id/scriptstate` | one chat row (`scriptstate`). | Hot path; now avoids all-message hydrate and all-character/nine-collection rewrites. |
| `PATCH chats/:id` | one chat row; + the parent character row only when `select:true` (`chatPage` moves). | Now `targeted-chat-row`. |
| `PUT chats/:id/lorebooks` | one chat row (`localLore`). | Cross-character normalization is validate-only. |

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, write the target chat row
  (+ parent character row only under the documented condition) inside the
  revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event; unchanged from the generic path.
- Normalization decision: `normalizeAllCharacterChats` and cross-character repairs
  are validate-only; scriptstate writes only the chat row.
- Projection: Phase 5 added the per-chat / `generation.persisted` branch.

## Done When

- scriptstate, chats/:id, and chats/:id/lorebooks report
  `mutationPath: "targeted-chat-row"` with `dbJsonWriteMs: 0`.
- The scriptstate hot path no longer hydrates messages or rewrites every
  character; rowid-stability tests prove unrelated chat and character rows are
  untouched.
- chats/:id writes the parent character row only when `select:true`.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
