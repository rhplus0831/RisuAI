# Single Character-Row Paths

Status: planned. Tier 3. Depends on the Phase 0 writer kit
(`writeSingleCharacterRow`, `writeSingleChatRow`).

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 3 "Single character row".
- `server/fastify/src/routes/commands.ts` - the routes below.
- `server/fastify/src/repository.ts` - `writeSingleCharacterRow`,
  `writeSingleChatRow`.

## Scope

The change is one character row (folders, scripts, `globalLore`, `modules` all
live in the character `data_json`, which excludes only `chats`). Narrow each to
`UPDATE characters WHERE id=?` with the documented conditional co-writes.

| Route (line) | Desired write |
| --- | --- |
| `PATCH characters/:id` (2350) | one character row, + settings only when the patch sets `trashTime` (re-runs `normalizeCharacterOrder`/`normalizeCurrentChar`). |
| `PUT characters/:id/lorebooks` (3528) | one character row (`globalLore`, can be large). |
| `POST characters/:id/chat-folders` (2811) | one character row (`chatFolders` inline on the character row). |
| `PATCH chat-folders/:folderId` (2853) | one character row. |
| `POST characters/:id/chat-folders/reorder` (2939) | one character row (`chatFolders` + optional `chatPage`). |
| `DELETE chat-folders/:folderId` (2896) | one character row (`chatFolders`) **+ that character's chat rows** whose `folderId` is nulled (`chat.folderId` lives in `chats`). |
| `POST characters/:id/chats/reorder` (2758) | that character's chat rows (positions shift) + its character row (`chatPage`); no messages (chat ids unchanged → `syncChatMessages` no-op). |
| `POST characters/:id/modules/reorder` (3782) | one character row (`character.modules`) **+ the `modules` table + `enabledModules`** when `ensureModuleRecords`/`ensureEnabledModules` actually mutate them. |
| `POST chats/:id/fork` (2655) | the source character's row (`chatPage`/`chatFolders`) + all of that character's chat rows (head `unshift` shifts positions) + the forked chat's new messages (surgical). Cross-character validation/normalization stays validate-only. |

fork (2655) is the one route here that touches messages, so it is excluded from
the Phase 1 message-free sweep and gets surgical forked-message persistence here.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json` (fork loads the source chat's
  messages), write the target character row (+ the documented chat rows /
  `modules` table / settings) inside the revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event; unchanged from the generic path.
- Normalization decision: global character de-dup and cross-character repairs are
  validate-only; each route re-normalizes only its target character (and its own
  chat rows where it writes them).
- Projection: stays broad until the matching Phase 5
  [`character-chat-projection-branches.md`](../phase-5-projection-range-narrowing/character-chat-projection-branches.md)
  lands; narrowing the write does not desync it.

## Done When

- Each route reports `mutationPath: "targeted-character-row"` (fork may show the
  surgical message write) with `dbJsonWriteMs: 0` where no message write occurs.
- Rowid-stability tests prove unrelated character rows, and all nine collection
  tables (except the `modules` table on modules/reorder), are untouched.
- chat-folders DELETE nulls `folderId` on exactly the affected chat rows;
  chats/reorder shifts only that character's chat rows; fork preserves surgical
  message semantics.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
