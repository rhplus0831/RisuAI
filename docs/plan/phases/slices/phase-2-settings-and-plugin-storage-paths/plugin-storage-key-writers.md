# Plugin Storage Key Writers

Status: planned. Tier 2. Depends on the Phase 0 writer kit
(`writePluginStorageKey` / `deletePluginStorageKey`).

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 2.
- `server/fastify/src/routes/commands.ts` - put (4032), delete (4066), bulk
  (4099).
- `server/fastify/src/repository.ts` - `plugin_custom_storage` (its own
  standalone table, written only at the tail of `replaceAllCollectionsInTable`,
  ~167-176).

## Scope

`pluginCustomStorage` is key-addressable but the three routes currently rewrite
all characters + all chats + all nine collection tables + settings +
`plugin_custom_storage` (`message-free`). Narrow each to touch only
`plugin_custom_storage`:

| Route (line) | Desired write |
| --- | --- |
| `PUT plugin-storage/:key` (4032) | single-key `UPSERT` |
| `DELETE plugin-storage/:key` (4066) | single-key `DELETE` |
| `POST plugin-storage/bulk` (4099) | `DELETE`-all + reinsert (clear semantics) |

`pluginCustomStorage` is neither a settings key nor one of the nine collection
tables, so it needs its own writer. These are written by plugins at runtime, so
the all-character rewrite is real recurring waste.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/repository.ts`.
- Durable path: validate message-free `db.json`, then
  `writePluginStorageKey`/`deletePluginStorageKey` (or the clear+reinsert for
  bulk) inside the revision/event transaction.
- Revision/event behavior: one `baseRevision` check, one revision bump, one
  event; unchanged from the generic path.
- Rollback/resync behavior: `db.json` written only after the SQLite commit.
- Projection: `pluginStorage` is intentionally full-bootstrap (sprawling), so
  narrowing the write yields no projection change but is correct.

## Done When

- The three routes report `mutationPath: "targeted-plugin-storage"` and write
  only `plugin_custom_storage`, with `dbJsonWriteMs: 0`.
- Rowid-stability tests prove no character, chat, collection, or settings row
  changed.
- A focused test covers put, delete, and bulk-clear semantics.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
