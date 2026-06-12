# Architecture And Structure

Date: 2026-05-30

The codebase is the source of truth; line numbers drift, the symbol names beside
them are the stable handle. Verify before acting.

## Storage Model (target)

Full detail in [`reference/storage-model.md`](reference/storage-model.md). The
target split after this workstream:

| Store | Holds |
| ----- | ----- |
| **SQLite `data/risu.db`** | `schema_version` (version + monotonic global revision); Hypa V3 memory tables; **new `messages` table** (`uid` PK, `chat_id` FK, `seq`, message fields, reroll alternates as flagged rows); **per-chat `hypaV3Data`** (heavy + chat-scoped → SQLite, not in the JSON blob). |
| **`data/db.json` (single file, in memory)** | Characters (incl. chat *metadata* minus `message[]`, `globalLore`, scripts), modules (incl. `lorebook`), settings, personas, presets, plugins. Loaded fully into memory at startup; rewritten on mutation, but now message-free so small and rarely churned. |
| **`data/assets/<sha256>.<ext>`** | Content-addressed asset bytes; server-side GC (Phase 1). |
| **In-memory `Database`** | Assembled from `db.json` (+ joined message rows when assembling a prompt). Source of truth for reads, assembly, and projection. Writes update memory + flush `db.json` + bump the SQLite revision. |
| **Client projection** | Stubs for chats/messages/lorebooks; full for everything else; hydrate-on-open served from server memory + the messages table. |

The current single-blob reality this evolves from: `db.json` is one file fully
rewritten on every mutation (`server/fastify/src/repository.ts:100-105`,
`writePersisted` = `JSON.stringify` + rename), and the bootstrap projection ships
the whole `Database` (`server/fastify/src/routes/bootstrap.ts`).

## Ownership Boundaries (seams this workstream touches)

- `server/fastify/src/db.ts` — SQLite schema + revision; **gains the `messages`
  table + `hypaV3Data` storage + migration** (Phase 4).
- `server/fastify/src/repository.ts` — `db.json` / assets / backups;
  `writePersisted` stays single-file (now message-free). **Asset GC** lands near
  here (Phase 1).
- `server/fastify/src/commands/mutations.ts` — `applyJsonCommandMutation`: revision
  check, mutate, bump, one event, rollback. Message-touching writes move to the
  SQLite path while still bumping the same revision and emitting one event
  (Phases 3–4, 6).
- `server/fastify/src/routes/bootstrap.ts` — projection shape; **emits stubs**
  (Phases 4–5) and already carries `activeGenerationJobs` (`:37`, consumed in
  Phase 7).
- `server/fastify/src/routes/events.ts` — command/memory SSE; frames carry
  `revision` and have **no `id:` line** (Phase 2 leans on the revision; no replay
  buffer).
- `server/fastify/src/routes/generationChat.ts` + `prompt/` — server assembly,
  dispatch, durable job, post-gen. **Assembler joins `db.json` + message rows**
  (Phase 4); **continue/regenerate become durable** (Phase 6). `persistDurableGenerationResult`
  (`:756`), reattach `GET .../:id/stream` (`:1234`), cancel `DELETE` (`:1251`).
- `src/ts/bootstrap.ts` — `refreshServerProjection` does the full `setDatabase`
  replace today (`:166`); **becomes surgical** (Phase 2). Integrity normalization
  over all characters (`:242`) must split into stub-level vs hydration-level.
- `src/ts/storage/database.svelte.ts` — `setDatabase` (`:106`), the read-only
  projection proxy (`:812`); **gains stub/hydration merge** through
  `withTrustedServerProjectionWrite`.
- `src/ts/server/projectionWriteGuard.svelte.ts` — `createReadOnlyServerProjection`
  (`:59`); hydration merges route through `withTrustedServerProjectionWrite`.
- `src/ts/server/lorebookBridge.svelte.ts` — **live** cross-character lorebook
  walks (`:89`, `:371`, `:421`); must become per-entity-on-hydration (Phases 4–5).
- `src/ts/process/index.svelte.ts` — `sendChat`; non-durable persist (B2) at
  `:399`; durable classification. Phases 3, 6.
- `src/ts/process/postGeneration/{streamResponse,nonStreamResponse}.ts` — continue
  append seam (`streamResponse.ts:62-66`, `nonStreamResponse.ts:86-89`).
- `src/ts/process/prereroll.ts` — transient reroll candidate buffer (becomes
  persisted, Phase 6).
- `src/ts/process/autoContinue.ts` + settings `autoContinueChat` /
  `autoContinueMinTokens` (`database.svelte.ts:568-569,1145-1146`) — removed
  (Phase 6).

## Key Data Shapes (current)

- `character` — `database.svelte.ts:1452` (`chats: Chat[]`, `globalLore`,
  `customscript`, `triggerscript`, `emotionImages`).
- `Chat` — `database.svelte.ts:1877` (`message: Message[]`, `localLore`,
  `hypaV3Data?`, `id?`, `scriptstate?`, `modules?`).
- `Message` — `database.svelte.ts:1905`. **No swipe field.** `chatId?` is the
  *message's* id (idempotency/generation key), not the chat's — the chat's id is
  `Chat.id`. This naming carries into the `messages` table (`uid` = `Message.chatId`).
- `RisuModule` — `src/ts/process/modules.ts:67` (`lorebook?`, `regex?`, `cjs?`,
  `trigger?`). Enabled-module display reads: `getModuleLorebooks` / `getModuleRegexScripts`
  (`modules.ts:440,487`) iterate `enabledModules` (`:418`).

## Test Layout (where new proof lands)

- Server: `server/fastify/__tests__/{commands,bootstrap,events,generation.chat,...}.test.ts`;
  new `messages` table + migration + assembler-join tests (Phase 4); durable
  continue/regenerate tests (Phase 6); asset-GC tests (Phase 1).
- Browser: `src/ts/bootstrap.test.ts`, `src/ts/server/*.test.ts`; surgical-sync
  decision-tree tests (Phase 2); stub/hydration tests (Phases 4–5).
- Generation: `src/ts/process/__tests__/sendChat.*`,
  `src/ts/process/request/tests/*`.
