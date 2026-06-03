# Single Character-Row Paths

Status: implemented (`fastify`: stages a `07971179`, c `7b735e8a`, d `65e57c0a`).
Tier 3. All nine routes report `targeted-character-row`: the six pure
character-row edits write one `UPDATE characters` (PATCH characters/:id co-writes
settings on `trashTime`; modules/reorder writes only `character.modules` and
drops module collection repairs as validate-only); chat-folders DELETE and
chats/reorder also write that character's own chat rows (via `writeSingleChatRow`
/ `writeCharacterChatRows`); fork inserts
the forked chat (`insertCharacterChatRow`) + its messages
(`replaceActiveChatMessages`) and validates message ids via the targeted
`activeMessageIdExists`.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 3 "Single character row".
- `server/fastify/src/routes/commands.ts` - the routes below.
- `server/fastify/src/repository.ts` - `writeSingleCharacterRow`,
  `writeSingleChatRow`.

## Scope

The change is one character row (folders, scripts, `globalLore`, `modules` all
live in the character `data_json`, which excludes only `chats`). Narrow each to
`UPDATE characters WHERE id=?` with the documented conditional co-writes.

| Route | Desired write |
| --- | --- |
| `PATCH characters/:id` | one character row, + settings only when the patch sets `trashTime` (re-runs `normalizeCharacterOrder`/`normalizeCurrentChar`). |
| `PUT characters/:id/lorebooks` | one character row (`globalLore`, can be large). |
| `POST characters/:id/chat-folders` | one character row (`chatFolders` inline on the character row). |
| `PATCH chat-folders/:folderId` | one character row. |
| `POST characters/:id/chat-folders/reorder` | one character row (`chatFolders` + optional `chatPage`). |
| `DELETE chat-folders/:folderId` | one character row (`chatFolders`) + that character's chat rows whose `folderId` is nulled (`chat.folderId` lives in `chats`). |
| `POST characters/:id/chats/reorder` | that character's chat rows (positions shift) + its character row (`chatPage`); no messages (chat ids unchanged → `syncChatMessages` no-op). |
| `POST characters/:id/modules/reorder` | one character row (`character.modules`); module and enabled-module repairs are validate-only. |
| `POST chats/:id/fork` | the source character's row (`chatPage`/`chatFolders`) + all of that character's chat rows (head `unshift` shifts positions) + the forked chat's new messages (surgical). Cross-character validation/normalization stays validate-only. |

fork is the one route here that touches messages, so it is excluded from
the Phase 1 message-free sweep and gets surgical forked-message persistence here.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json` (fork loads the source chat's
  messages), write the target character row (+ the documented chat rows /
  settings where applicable) inside the revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event; unchanged from the generic path.
- Normalization decision: global character de-dup and cross-character repairs are
  validate-only; each route re-normalizes only its target character (and its own
  chat rows where it writes them).
- Projection: Phase 5 added the matching
  [`character-chat-projection-branches.md`](../phase-5-projection-range-narrowing/character-chat-projection-branches.md)
  refresh shapes; narrowing the write does not desync them.

## Done When

- Each route reports `mutationPath: "targeted-character-row"` (fork may show the
  surgical message write) with `dbJsonWriteMs: 0` where no message write occurs.
- Rowid-stability tests prove unrelated character rows and all nine collection
  tables are untouched.
- chat-folders DELETE nulls `folderId` on exactly the affected chat rows;
  chats/reorder shifts only that character's chat rows; fork preserves surgical
  message semantics.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
