# Single Chat-Row Paths

Status: planned. Tier 3. Depends on the Phase 0 writer kit (`writeSingleChatRow`
— no `chats` single-row writer exists today).

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 3 "Single chat row".
- `server/fastify/src/routes/commands.ts` - scriptstate (2983), chats/:id PATCH
  (2560), chats/:id/lorebooks (3564).
- `server/fastify/src/repository.ts` - `writeSingleChatRow`.

## Scope

The change is one chat row (`scriptstate` and `localLore` live in
`chats.data_json`). Narrow each to `UPDATE chats WHERE id=?`.

| Route (line) | Desired write | Notes |
| --- | --- | --- |
| `PATCH chats/:id/scriptstate` (2983) | the patched chat row (`scriptstate`); + its parent character row only if keeping the `normalizeAllCharacterChats` repairs. | Hot path (script/generation runtime), currently `hydrated`. Dominant win is dropping the all-message hydrate + the all-character/nine-collection rewrite on every scriptstate write. |
| `PATCH chats/:id` (2560) | one chat row; + the parent character row only when `select:true` (`chatPage` moves). | Already `message-free`. |
| `PUT chats/:id/lorebooks` (3564) | one chat row (`localLore`). | Needs `writeSingleChatRow` and a policy on cross-character normalization (validate-only). |

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
  are validate-only; the scriptstate path either keeps the parent-character-row
  write (if it relies on those repairs) or records dropping them — recorded here.
- Projection: stays broad until the Phase 5 per-chat / `generation.persisted`
  branch lands.

## Done When

- scriptstate and chats/:id/lorebooks report `mutationPath: "targeted-chat-row"`
  (chats/:id stays `message-free` or moves to `targeted-chat-row`) with
  `dbJsonWriteMs: 0`.
- The scriptstate hot path no longer hydrates messages or rewrites every
  character; rowid-stability tests prove unrelated chat and character rows are
  untouched.
- chats/:id writes the parent character row only when `select:true`.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
