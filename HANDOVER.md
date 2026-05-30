# Lazy-Projection Handover

Date: 2026-05-30 · Branch: `fastify` · Plan: [`docs/lazy-projection/`](docs/lazy-projection/)

This is a session handover for the **lazy-projection** workstream. Four of the
seven phases are implemented, tested, and committed; this document hands off the
remaining three — most importantly a **slice plan for Phase 4**, the lynchpin.

The codebase is the source of truth. Line numbers below drift; the **symbol
names** beside them are the stable handle — `rg` for the symbol before acting.

---

## Status

| Phase | State | Commit | Delivers |
| ----- | ----- | ------ | -------- |
| 1 Asset GC → server | ✅ done | `f6657d49` | `server/fastify/src/assetGc.ts` (`runAssetGc`, mtime grace, unref'd interval in `buildApp`); deleted dead client GC. |
| 2 Surgical inbound sync | ✅ done | `36c5f39a` | Revision echo-skip + targeted `GET /api/v1/projection/:resource` + gap/reconnect full-bootstrap. **Built the per-resource fetch primitive Phases 4–5 reuse for hydration** (`fetchServerProjectionResource`, `mergeServerProjectionFields`, `peekCachedServerCommandRevision`). |
| 3 Unify generation persistence | ✅ done | `24f25b91` | Server owns ALL result writes; removed browser B2. `persistServerGenerationResult` (+`targetMessageId`); inline continue=extend-in-place, regenerate=replace-target. |
| 7 Browser auto-reattach | ✅ done | `6aabc4e9` | `activeGenerationJobs` client contract + reattach GET mode in `requestServerChatGeneration` + `reattachServerBackedSendChat` + `src/ts/process/reattach.ts`. |
| **4 Chats/messages → SQLite + stub-load** | ⏳ TODO | — | The lean-projection headline. **Sliced below.** |
| 5 Lorebooks stub | ⏳ TODO | — | Needs Phase 2 (done); shares `lorebookBridge` rework with Phase 4. |
| 6 Durable continue/regenerate + reroll | ⏳ TODO | — | Reroll buffer needs Phase 4's table. |

Baselines (green at every commit above): `pnpm api:test` = **1351**,
`pnpm test` = **985**, `pnpm client-thinning:audit` = pass.

**Hard rule from the project (memory `fastify-no-users-no-interim-compat`):** no
interim / back-compat / demo states. Each slice below is defined to be a
**coherent, fully-working unit** that leaves both suites green — land related
steps together, never a dangling unused table.

---

## Phase 4 — slice plan

**Goal:** chat `message[]` moves out of `data/db.json` into a SQLite `messages`
table; the bootstrap ships chat **stubs**; the client hydrates a chat's messages
on open. Two wins: **wire-cost** (bootstrap stops scaling with history) and
**write-cost** (a message append becomes one row insert, not a whole-blob
rewrite).

The surface (verify before acting; full map was at
`/tmp/lazy-projection/phase4-surface-map.json`, regenerate if gone):

- **Storage boundary:** `server/fastify/src/repository.ts` —
  `loadPersisted` / `writePersisted` / `applyImport`; `Persisted.database`
  embeds `characters[].chats[].message[]`.
- **Message commands:** `server/fastify/src/routes/commands.ts` — append
  (`~2913`), update (`~2954`), delete (`~2993`), truncate (`~3026`), replace
  (`~3072`), generation-result (`~3112`), fork (`~2300`). Helpers in
  `server/fastify/src/commands/messages.ts`: `normalizeAllChatMessages`,
  `ensureChatMessages`, `requireChatMessages`, `requireMessageLocation`,
  `messageIdExists`, `validateUniqueMessageIds`, `normalizeGlobalMessageIds`.
- **Mutation engine:** `server/fastify/src/commands/mutations.ts` —
  `applyJsonCommandMutation` (clone db.json → mutate → `writePersisted` → bump
  revision → emit one event, rollback on failure). This is the atomicity
  contract every slice must preserve.
- **Assembler reads:** `server/fastify/src/prompt/history.ts`
  (`buildHistoryWindow` `~465`) + `server/fastify/src/prompt/assemble.ts`
  (~15 reads of `currentChat.message`; `appendUserMessageRow`,
  `prepareRegenerateTranscript`, `runInputTrigger`, `applyEditInput`,
  `appendAssistantRow`, `runServerPostGeneration`).
- **Generation persistence:** `server/fastify/src/routes/generationChat.ts` —
  `persistServerGenerationResult`, `persistAssemblyMutations`.
- **Projection:** `server/fastify/src/routes/bootstrap.ts` (ships
  `loadPersisted().database` wholesale).
- **Import/export:** `server/fastify/src/risuSave/` + `applyImport`.
- **Schema/migration:** `server/fastify/src/db.ts` — `CURRENT_SCHEMA_VERSION`
  (=3), `MIGRATIONS`, `applyMigrations`, `bumpRevision`, `getSchemaState`.
- **Client:** `src/ts/bootstrap.ts` integrity pass (`checkNewFormat`, `~242`,
  defaults `v.chats`); `src/ts/server/lorebookBridge.svelte.ts` chat-loop
  (`chat.localLore` `~91`, find-chat-by-id `~421`); chat-open =
  `selectedCharID` + `character.chatPage` (`src/ts/stores.svelte.ts`);
  hydration merge via `mergeServerProjectionFields` (Phase 2).

### Data shapes (current)
- `Chat` (`src/ts/storage/database.svelte.ts:1877`): `message: Message[]`,
  `id?`, `localLore`, `hypaV3Data?`, `scriptstate?`, `bookmarks?`,
  `bookmarkNames?`, …
- `Message` (`:1905`): `role`, `data`, `chatId?` (**this is the message's own
  id / the `uid` PK — NOT the chat's id**), `saying?`, `time?`,
  `generationInfo?`, `promptInfo?`, `name?`, `otherUser?`, `disabled?`,
  `isComment?`. **No swipe field.**

### Slices (ordered; each leaves the suites green)

**Slice 4.1 — Storage-boundary flip + migration (behavior-preserving).**
The foundation: messages physically move to SQLite, but every reader still sees a
fully-hydrated `database`, so no command/assembler/projection code changes yet.
- `db.ts`: bump `CURRENT_SCHEMA_VERSION` → 4; add a `messages` table
  (`uid` PK, `chat_id` TEXT, `seq` INTEGER, `role`, `data`, `disabled`, plus a
  `json` TEXT column holding the full `Message` record for lossless round-trip;
  index `(chat_id, seq)`). Cascade is logical (db.json owns chat lifecycle), so
  deletes are handled by the command layer, not FK cascade.
- New `server/fastify/src/messageStore.ts`: `replaceChatMessages(db, chatId,
  messages)`, `getChatMessages(db, chatId)`, `deleteChatMessages(db, chatId)`,
  `getAllChatIdsWithMessages(db)`. Pure CRUD over the table; preserves array
  order via `seq = index`.
- Migration (v4 `up`): one-time extract — read `db.json` via `loadPersisted`,
  normalize ids (`normalizeAllChatMessages` already assigns chat/message ids),
  write each chat's messages into the table, then rewrite db.json message-free.
  Must be idempotent (guard on `schema_version`).
- `repository.ts`: `loadPersisted(dataDir)` → after parsing, **join** each
  chat's messages from the table back into `chat.message` (needs the `db`
  handle; thread it in, or add `loadPersistedWithMessages(db, dataDir)` used by
  the mutation engine + assembler + projection). `writePersisted(db, dataDir,
  next)` → strip `chat.message` out of the JSON, `replaceChatMessages` per chat,
  write message-free JSON. **Keep the whole op synchronous + transactional**
  (SQLite `BEGIN IMMEDIATE` around the message writes + the JSON write, mirroring
  `applyJsonCommandMutation`'s rollback).
- `applyImport` + risuSave import/export ride `loadPersisted`/`writePersisted`,
  so they split/reassemble for free — **verify** the risuSave codec doesn't
  bypass those boundaries (`risuSave/codec.ts`, `bundleExport.ts`).
- Tests: messageStore CRUD; migration extract/idempotency; a load→write→load
  round-trip preserves messages byte-for-byte; existing command + bootstrap +
  generation tests stay green unchanged.
- Risk: the join/sync is the new surface. Atomicity across SQLite + db.json is
  the landmine — one transaction, rollback on failure.

**Slice 4.2 — Surgical message writes (realizes the write-cost win).**
Stop loading+syncing ALL messages per mutation; message commands touch only their
chat's rows.
- Rework the six message commands + fork (`commands.ts`) and
  `persistServerGenerationResult` / `persistAssemblyMutations`
  (`generationChat.ts`) to mutate via `messageStore` directly (append = one
  insert at `max(seq)+1`; delete = one delete + reseq; replace = `replaceChatMessages`),
  inside the same `applyJsonCommandMutation` transaction + revision bump + event.
- Global-id operations (`messageIdExists`, `normalizeGlobalMessageIds`,
  `requireMessageLocation`) become SQLite queries (`SELECT … WHERE uid = ?`)
  instead of walking all chats.
- Non-message commands stay on the (now message-free, cheap) db.json path.
- Tests: each command's existing tests stay green; add a test asserting an
  append does NOT rewrite unrelated chats' message rows.
- Risk: the global-uniqueness + reseq semantics must match
  `commands/messages.ts` exactly (the dedupe/repair behavior is load-bearing).

**Slice 4.3 — Bootstrap chat stubs + client hydrate-on-open (realizes the
wire-cost win).**
- `routes/bootstrap.ts`: project chat **stubs** — chat metadata + a
  message-count/last-message header, **no `message[]`**. (Keep `loadPersisted`'s
  joined form for the assembler; only the *projection* strips messages.)
- Add a per-chat message hydration response to the Phase 2 projection endpoint
  (`routes/projection.ts`): `GET /api/v1/projection/chat?id=<chatId>` →
  `{ revision, fields: { … the chat's message[] … } }`, served from
  `getChatMessages`. Reuse the `mode:'fields'` contract.
- Client: on chat-open (`selectedCharID` / `chatPage` change — hook near
  `src/ts/process/reattach.ts`'s `selectedCharID.subscribe` pattern, or a
  dedicated `$effect`), call `fetchServerProjectionResource('chat', { id })` and
  merge via `mergeServerProjectionFields` (Phase 2 echo-skip already prevents the
  SSE refresh from re-stubbing it).
- `src/ts/bootstrap.ts` integrity pass (`checkNewFormat`, `~242`): split into
  **stub-level** defaults (chat exists, has metadata) vs **hydration-level**
  defaults (`message[]` filled on open).
- `lorebookBridge.svelte.ts` chat-loop (`chat.localLore`): operate per-chat on
  hydration, not over all chats at startup.
- Tests: bootstrap payload no longer scales with history; opening a chat hydrates
  its messages; the SSE refresh does not clobber a hydrated chat (extends the
  Phase 2 decision-tree tests).
- Risk: any client path that reads ALL chats' messages at startup (chat-list
  last-message preview, search, the integrity pass) breaks — audit for it. Chat
  objects themselves must NOT be stubbed away (only their `message[]`).

**Slice 4.4 — `hypaV3Data` → SQLite (optional, bundles with 4.1/4.3).**
`Chat.hypaV3Data` is a heavy per-chat blob, barely read server-side (only
`memoryLegacyImport.ts`). Same boundary treatment as messages (own table, strip
from db.json + projection, hydrate on open). Low server surface; the win is
removing it from the wire. Can ride 4.1's migration.

> **Byte-parity gate (all slices):** `server/fastify/__tests__/assemble.test.ts`
> + `history.test.ts` are golden assembler tests — keep them green to prove the
> assembled prompt is unchanged across the storage move.

---

## Phase 5 — Lorebooks stub (notes)

Needs Phase 2 (done). Stub character `globalLore` + **disabled**-module
`lorebook` in the projection; hydrate on character/module open; **enabled**
modules stay resident (synchronous CBS `{{lorebook}}` / regex / trigger reads
cannot await — `src/ts/process/modules.ts:418,440,487`; `src/ts/cbs.ts:353`).

**Data-loss hazard (read before touching):** `src/ts/server/lorebookBridge.svelte.ts`
is LIVE and runs a snapshot/diff that auto-persists lorebook changes
(`dispatchWatchedReplacement`, `~371`). If it observes a stubbed (empty)
lorebook, it can diff-persist the deletion and **lose the real entries**. The
rework must (a) never diff a stubbed entity, and (b) only ever operate
per-entity on hydration. This — not the projection change — is the bulk of the
phase.

---

## Phase 6 — Durable continue/regenerate + reroll buffer (notes)

The **reroll buffer = alternate rows** in Phase 4's `messages` table (flagged,
no active `seq`), so this phase **needs Phase 4** for its headline. Parts doable
earlier:
- **Remove auto-continue** (`src/ts/process/autoContinue.ts` +
  `evaluateAutoContinue` call in `postGeneration/orchestrateResponse.ts:209` +
  the `status:'continue'` recursion in `index.svelte.ts:~344` + settings
  `autoContinueChat`/`autoContinueMinTokens` + `usedContinueTokens`). Off by
  default. Sprawls into the settings UI + i18n (`src/lang/*`) +
  `orchestrateResponse.test.ts` (which mocks `../autoContinue`).
- **Widen `resolveDurableGeneration`** (`src/ts/process/request/durableGeneration.ts`)
  to `continue`/`regenerate` so they run as detached jobs (survive disconnect).
  Phase 3 already made them server-persisted; the durable job's
  `buildDurablePostGeneration` is send-only and must adopt the mode-aware
  persistence (`resolveInlineGenerationMessage` is the reusable logic).

---

## Pointers

- Plan + decisions: [`docs/lazy-projection/plan.md`](docs/lazy-projection/plan.md),
  [`reference/decisions.md`](docs/lazy-projection/reference/decisions.md),
  [`reference/storage-model.md`](docs/lazy-projection/reference/storage-model.md).
- Test commands: `pnpm api:test` (server), `pnpm test` (browser),
  `pnpm client-thinning:audit` (the invariant gate — keep green; add a rule if a
  slice establishes a new invariant).
- Progress memory: `lazy-projection-phases-1-2-3-7-landed` (in the agent memory).
- The Phase 2 primitive is the hydration vehicle for 4 & 5 — reuse
  `fetchServerProjectionResource` + `mergeServerProjectionFields`, don't reinvent.
