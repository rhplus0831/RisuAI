# Lazy-Projection Handover

Date: 2026-05-30 · Branch: `fastify` · Plan: [`docs/lazy-projection/`](docs/lazy-projection/)

Session handover for the **lazy-projection** workstream. **Phase 4 is fully done**
(messages + hypaV3Data → SQLite, surgical writes, stub bootstrap + hydrate-on-open),
plus Phase 6's **auto-continue removal**. Two pieces remain: **Phase 5** (lorebook
stub) and the rest of **Phase 6** (durable continue/regenerate + reroll buffer).

The codebase is the source of truth. Line numbers drift; the **symbol names** are
the stable handle — `rg` for the symbol before acting.

Baselines (green at HEAD `5b751fcb`): `pnpm api:test` = **1370**,
`pnpm test` = **990** (+4 skipped), `pnpm client-thinning:audit` = pass.
SQLite schema is at **v5** (`CURRENT_SCHEMA_VERSION`, `server/fastify/src/db.ts`).

**Hard rule (memory `fastify-no-users-no-interim-compat`):** no interim /
back-compat / demo states. Each slice is a coherent, fully-working unit that
leaves all suites green — land related steps together.

---

## Status

| Phase | State | Commit(s) | Delivers |
| ----- | ----- | --------- | -------- |
| 1 Asset GC → server | ✅ | `f6657d49` | server-side asset GC. |
| 2 Surgical inbound sync | ✅ | `36c5f39a` | revision echo-skip + targeted `GET /projection/:resource`. |
| 3 Unify generation persistence | ✅ | `24f25b91` | server owns all result writes. |
| 7 Browser auto-reattach | ✅ | `6aabc4e9` | reattach to in-flight generations. |
| **4.1** messages → SQLite (storage flip) | ✅ | `b27c0b9e`, `c15bdc6a` | `messageStore.ts` `messages` table; message-aware load/write boundary; hardened by adversarial review. |
| **4.2** surgical message writes | ✅ | `92dd2857` | `applyChatMessageDiff` / `syncChatMessages`: append = 1 insert, non-message commands write nothing. |
| **4.3** stub bootstrap + hydrate-on-open | ✅ | `24f8f8d3`, `de295e3d` | `loadStubProjection`, `GET /projection/chatMessages?id=`, client `chatMessageHydration.svelte.ts`; hardened by review. |
| **4.4** hypaV3Data → SQLite | ✅ | `5000be42` | `chat_hypa_v3` table; same boundary + hydration as messages. |
| **6 (a)** remove auto-continue | ✅ | `5b751fcb` | deleted the off-by-default feature + settings + i18n + recursion. |
| **6 (b)** durable continue/regenerate | ✅ | `d48bff23`, `b145ed72` | widened `resolveDurableGeneration` + the durable job to `send\|continue\|regenerate` (shared `resolvePostGenerationResult`/`buildRawModeMessage`); mode-aware reattach (job carries `mode` on `activeGenerationJobs`). Adversarially reviewed (only the reattach finding, fixed in `b145ed72`). |
| **5** Lorebooks stub | ⏳ TODO | — | stub globalLore + module lorebook; **lorebookBridge data-loss hazard**. |
| **6 (c)** reroll buffer | ⏳ TODO | — | alternate rows in the `messages` table; "no rerolled result is lost". |

Two adversarial reviews were run (4.1 and 4.2+4.3); all confirmed findings were
fixed in `c15bdc6a` / `de295e3d`. Progress memory: `lazy-projection-phase4-landed`.

---

## Architecture now in place (read before touching storage)

`data/db.json` holds chat **metadata only** — no `message[]`, no `hypaV3Data`.
Those two unbounded per-chat blobs live in SQLite (`data/risu.db`):

- **`messages` table** — PK `(chat_id, seq)`, plus `uid` (the message's own id,
  the `Message.chatId` misnomer; globally unique by the command-layer invariant)
  and a `json` column (lossless source of truth). `server/fastify/src/messageStore.ts`.
- **`chat_hypa_v3` table** — `chat_id` PK, `json`. Same file.

`server/fastify/src/repository.ts` is the boundary:

- `loadPersisted` / `writePersisted` — **message-free** db.json (asset-GC /
  memory / backup paths that never read messages keep using these).
- `loadPersistedWithMessages(db, dataDir)` — **hydrated** join (messages +
  hypaV3Data), with a SQLite-or-embedded fallback for un-extracted chats. Used by
  prompt **assembly**, risuSave **export**, the legacy-memory backfill, and the
  mutation engine's mutate input.
- `loadStubProjection(db, dataDir)` — **stubs** (`message: []`, no hypaV3Data) for
  the **wire**: the bootstrap (`routes/bootstrap.ts`) and the foreign-event
  projection (`routes/projection.ts`).
- `splitChatMessagesIntoTable` (whole rebuild, used by `applyImport`),
  `syncChatMessages` (surgical per-chat diff, used by the mutation engine),
  `stripChatMessages`, `ensureMessagesExtracted` (idempotent startup extraction,
  wired in `app.ts` **after** the legacy-memory backfill), `loadChatHydration`
  (one chat's `{ message, hypaV3Data }` for the hydration endpoint).

Write atomicity: the mutation engine (`commands/mutations.ts`) and `applyImport`
write the SQLite rows + revision bump inside `BEGIN IMMEDIATE`, then write db.json
**after** COMMIT (so db.json can only lag, never lead, on a crash). `applyImport`
persists a `structuredClone` so it never mutates the caller's payload.

Client hydration: `src/ts/server/chatMessageHydration.svelte.ts` hydrates the
**active chat** on open (reactive `$effect` on a `selectedCharID` mirror +
`chatPage`), re-hydrates after any full re-apply or a `characters` event-merge
(`resetChatHydration()` in `bootstrap.ts`), and exposes `ensureAllChatsHydrated`
for the bulk readers (`exportAsDataset`, `exportChat`, `exportAllChats`, the
branch-tree alert; cold storage is a no-op on Fastify). Merge:
`hydrateServerChatMessages` (`storage/database.svelte.ts`).

---

## Phase 6 (b): durable continue/regenerate (next, server-testable)

**Goal:** continue + regenerate survive a mid-generation disconnect (today only
`send` is durable). This is the user's stated real goal (memory
`durable-generation-end-goal`). The mode-aware persistence logic **already
exists** — the durable job just doesn't use it yet.

Findings (all in `server/fastify/src/routes/generationChat.ts`):
- `resolveDurableGeneration` (`src/ts/process/request/durableGeneration.ts`)
  hard-restricts to `send` (decision #1). **Widen** it to `send | continue |
  regenerate` (the `non-durable` reason no longer applies to those modes).
- The **inline** path `buildPostGenerationFrame` already finalizes all 3 modes
  correctly via `resolveInlineGenerationMessage` (continue = extend the last char
  row keeping its id; regenerate = replace `regenerateMessageId`; send = append),
  capturing `continueBase`/`continueRow` before post-gen mutates in place, and
  passing `targetMessageId` to `persistServerGenerationResult`.
- The **durable** job path `buildDurablePostGeneration` is **send-only**: it calls
  `extractAssistantMessage` and `persistServerGenerationResult` with **no**
  `targetMessageId`. → Rework it to mirror `buildPostGenerationFrame`'s mode-aware
  finalization (reuse `resolveInlineGenerationMessage` + the continue-base capture
  + `targetMessageId`).
- `persistServerGenerationResult` already supports `targetMessageId`
  (continue = extend-in-place by id, regenerate = replace target). Verified by
  the existing `generation.chat.test.ts` continue/regenerate cases.

Risk: **idempotency on replay** — continue's extend and regenerate's replace must
be no-ops if the job's commit runs twice (keyed by `generationId` / target id).
The one-job-per-chat lock (`generationJobs.ts`) blocks a `send`-during-reroll race.

Tests: `durableGeneration.test.ts` (server) for disconnect-survival of
continue/regenerate; `generation.chat.test.ts` for the persisted result shape.
Client routing widens automatically once `resolveDurableGeneration` does; reattach
(Phase 7) already exists.

## Phase 6 (c): reroll buffer (after 6b)

Decision (`reference/durable-generation-modes.md`): regenerate's commit = **add
the new candidate as an alternate row + make it active**; the old candidate
becomes a flagged alternate in the **`messages` table** (no active `seq`).
Cleared on `send`/`continue`. Navigation stays client-side (active = the
positioned tail). This needs a new `alternate`/flag column on `messages` (a v6
migration) + `messageStore` ops + the regenerate commit path + the prereroll
buffer (`src/ts/process/prereroll.ts`) persisting candidates instead of staying
transient. **Highest-risk piece** — swipe/reroll UX; validate in the real app.

---

## Phase 5: Lorebooks stub (TODO — HIGH RISK)

Stub character `globalLore` + **disabled**-module `lorebook` in the projection;
hydrate on character/module open; **enabled** modules stay resident (synchronous
CBS `{{lorebook}}` / regex / trigger reads cannot await —
`src/ts/process/modules.ts`, `src/ts/cbs.ts`).

**Data-loss hazard (the bulk of the phase):**
`src/ts/server/lorebookBridge.svelte.ts` runs a snapshot/diff that auto-persists
lorebook changes (`dispatchWatchedReplacement`). If it observes a stubbed (empty)
lorebook it can diff-persist the deletion and **lose the real entries**. The
rework must (a) never diff a stubbed entity, and (b) only operate per-entity on
hydration. The hydration machinery from Phase 4.3
(`fetchServerProjectionResource` + a nested merge like `hydrateServerChatMessages`)
is the reusable vehicle; `loadStubProjection` is where the server would strip the
lorebook fields. **Note:** lorebookBridge does **not** read `chat.message`, so it
was untouched by Phase 4 — but it *does* diff `chat.localLore` / `globalLore`.

---

## Pointers

- Plan + decisions: [`docs/lazy-projection/plan.md`](docs/lazy-projection/plan.md),
  [`reference/decisions.md`](docs/lazy-projection/reference/decisions.md),
  [`reference/durable-generation-modes.md`](docs/lazy-projection/reference/durable-generation-modes.md),
  [`reference/stub-hydration.md`](docs/lazy-projection/reference/stub-hydration.md).
- Test commands: `pnpm api:test` (server), `pnpm test` (browser),
  `pnpm client-thinning:audit` (invariant gate). `tsc --noEmit` on the server has
  pre-existing test-file type errors and is NOT the gate (vitest uses esbuild).
- Adversarial review pattern used this session: a `Workflow` with per-dimension
  reviewers → per-finding verifiers (default-refute) → synthesize confirmed. Worth
  re-running on Phase 5/6 since the real app cannot be launched here.
- Progress memory: `lazy-projection-phase4-landed`, `lazy-projection-phases-1-2-3-7-landed`.
