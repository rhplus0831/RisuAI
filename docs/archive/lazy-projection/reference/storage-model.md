# Reference: Storage Model

Date: 2026-05-30

Backs Phases 4–6. The target storage split and the `messages` table shape.

## Current reality

- `data/db.json` is **one** file holding the whole `Database` blob, fully rewritten
  on every mutation: `writePersisted` does `JSON.stringify(next)` + `rename`
  (`server/fastify/src/repository.ts:100-105`), called from `applyJsonCommandMutation`
  (`server/fastify/src/commands/mutations.ts:59,79`).
- `data/risu.db` (SQLite) holds `schema_version` (version + monotonic global
  revision) and the Hypa V3 memory tables (`server/fastify/src/db.ts`).
- The server loads the whole `db.json` into memory (`loadPersisted`) and assembles
  prompts from it; the bootstrap projection ships the whole `Database`.
- Chat history is embedded: `character.chats[].message[]` (`database.svelte.ts:1452,1877`).
  So appending one message rewrites the entire blob.

## Target split

| Store | Holds |
| ----- | ----- |
| **SQLite `risu.db`** | `schema_version`; Hypa V3 memory tables; **`messages` table**; **per-chat `hypaV3Data`**. |
| **`data/db.json`** (single, in memory) | Characters + chat *metadata* (minus `message[]`) + `globalLore` + scripts; modules + `lorebook`; settings, personas, presets, plugins. Message-free → small, rarely churned. |
| **`data/assets/`** | Content-addressed bytes; server GC (Phase 1). |
| **In-memory `Database`** | Assembled from `db.json` (+ joined message rows for assembly). Source of truth for reads/assembly/projection. Writes update memory + flush `db.json` + bump the SQLite revision. |
| **Client projection** | Stubs for chats/messages/lorebooks; full otherwise; hydrate-on-open from server memory + the messages table. |

**The single `db.json` stays.** Moving chat *messages* out to SQLite — the
unbounded, high-churn part — keeps the remaining blob small and rarely rewritten.

## `messages` table (Decision 2 + refinements)

Columns:
- `uid` — PK. This is the existing per-message identity, today stored as
  `Message.chatId` (a misnomer — it is the *message's* id / generation-idempotency
  key, set e.g. to `generationId` for assistant rows). The *chat's* id is `Chat.id`.
- `chat_id` — FK to the chat (`Chat.id`). Cascade-delete with the chat (and the
  character).
- `seq` — explicit integer ordering. Required: a relational table has no inherent
  order, and the conversation depends on it (append, regenerate-truncate, delete,
  disable). Append = `max(seq)+1`.
- message fields — `role`, `data`, `saying`, `time`, `generationInfo`, `promptInfo`,
  `disabled`, etc. (`Message`, `database.svelte.ts:1905`; note: **no swipe field**).
- alternate flag — reroll alternates (Phase 6) are rows in this table with no
  active `seq` (flagged), belonging to the chat. **Not** a JSON array on the chat.

## hypaV3Data

`Chat.hypaV3Data?` (`database.svelte.ts:1891`) is a heavy per-chat serialized blob.
It moves to SQLite (chat-scoped) so it neither bloats `db.json` nor gets rewritten
on unrelated mutations. Keep it distinct from the Hypa V3 *memory tables*
(chunks/summaries/embeddings) — both server-side, different data.

## Consistency

A message write (or alternate insert/clear) must bump the same global revision and
emit one command event, atomically with the SQLite row change, with rollback on
failure — the same contract `applyJsonCommandMutation` upholds today across the
`db.json` + revision pair.
