# Phase 4: Chats/Messages → SQLite + Stub-Load

Date: 2026-05-30

Status: PLANNED. The largest phase. Needs Phase 2; eased by Phase 3.

## Goal

Move chat **messages** into a SQLite table (one row per message); ship chat/message
**stubs** in the bootstrap projection; hydrate a chat's messages on chat-open. Move
the heavy per-chat `hypaV3Data` blob to SQLite alongside. Keep a single, now
message-free `data/db.json`.

Storage detail: [`../reference/storage-model.md`](../reference/storage-model.md).
Stub/hydration model: [`../reference/stub-hydration.md`](../reference/stub-hydration.md).

## Why this is the big win

- **Wire cost.** Chat history (`character.chats[].message[]`) is the unbounded part
  of the bootstrap blob; stubs remove it from startup.
- **Write cost.** Today appending one message rewrites the whole `db.json`
  (`server/fastify/src/repository.ts:100-105`). Rows-per-message in SQLite turns an
  append into one row insert.

## Changes

### Message table (Decision 2 + refinements)
- New `messages` table: `uid` PK (= the existing per-message id, today
  `Message.chatId` — note the misnomer; the chat's id is `Chat.id`), `chat_id` FK,
  explicit **`seq`** ordering column, and message fields (`role`, `data`, `saying`,
  `time`, `generationInfo`, `promptInfo`, `disabled`, ...).
- Reroll alternates (Phase 6) are rows in this same table flagged as alternates
  (no active `seq`); not a JSON array.
- Cascade deletes: deleting a chat deletes its message rows; deleting a character
  deletes its chats' rows.
- `hypaV3Data` moves to SQLite (per-chat, heavy) so it does not bloat / churn
  `db.json`.

### Server
- One-time **migration** extracting embedded `Chat.message[]` (+ `hypaV3Data`) from
  `db.json` into the tables (`server/fastify/src/db.ts` migration framework).
- **Assembler join**: server prompt assembly reads character/chat metadata from
  the in-memory `Database` + the chat's messages from SQLite
  (`server/fastify/src/prompt/assemble.ts`, `prompt/history.ts`).
- Redirect the unified result writer (Phase 3) to the SQLite message path, still
  bumping the same global revision and emitting one event (atomic across stores).
- `risuSave` import/export splits embedded chats out on import and reassembles on
  export.
- Bootstrap projection emits chat **stubs** (chat metadata + message-count/headers,
  no `message[]`).

### Client
- Hydrate a chat's messages on open via the Phase 2 targeted-fetch primitive; merge
  through `withTrustedServerProjectionWrite`.
- Split the integrity/normalization pass (`src/ts/bootstrap.ts:242`, which defaults
  `v.chats`, `v.customscript`, `v.globalLore`, ...) into stub-level vs
  hydration-level defaults.
- Rework the `lorebookBridge` **chat loop** (it touches `chat.localLore`,
  `src/ts/server/lorebookBridge.svelte.ts:91-93`) to operate per-chat on hydration.

## Seams

- `server/fastify/src/db.ts`, `repository.ts`, `prompt/assemble.ts`,
  `prompt/history.ts`, `routes/bootstrap.ts`, `routes/generationChat.ts`,
  `risuSave/`.
- `src/ts/bootstrap.ts`, `src/ts/storage/database.svelte.ts`,
  `src/ts/server/lorebookBridge.svelte.ts`.

## Risks / landmines

- **Atomicity across stores.** A message write + revision bump + event must be one
  transaction; rollback on failure (mirrors today's db.json + revision rollback).
- **Ordering.** `seq` must reproduce array order under append / regenerate-truncate
  / delete / disable.
- **Two-store chat.** A chat is split (metadata in `db.json`, messages + hypaV3Data
  in SQLite); the assembler/hydration join is the new surface.
- Keep the per-chat `hypaV3Data` blob distinct from the Hypa V3 *memory tables*
  (chunks/summaries/embeddings) — both server-side, different things.

## Exit criteria

- Opening a chat hydrates its messages from SQLite; bootstrap payload no longer
  scales with total history.
- A message append is one row insert (no whole-blob rewrite).
- Server assembly is byte-parity with pre-migration output (golden test).
- Migration + `risuSave` round-trip verified.
