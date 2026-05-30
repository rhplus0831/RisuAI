# Reference: Locked Decisions

Date: 2026-05-30

The decisions that shaped this plan, with rationale. These were settled through a
sequence of design reviews before any code was written.

## Storage and projection

- **Decision 1 — Asset GC moves to the server.** The client GC (`cleanChunks` /
  `getUncleanables`) is already dead code (callerless); there is no asset GC at all
  in Fastify mode. Build a periodic server-side, reference-counted GC. → Phase 1.
- **Decision 2 — Messages get their own SQLite table** (one row per message), with
  refinements: `uid` PK (= existing `Message.chatId`, the per-message id; the
  chat's id is `Chat.id`), `chat_id` FK, an explicit `seq` ordering column, and
  reroll alternates stored as flagged rows in the same table (not a JSON array).
  No JSON blob. → Phases 4, 6.
- **Decision 3 — Keep a single `db.json`.** Once messages move to SQLite
  (Decision 2), the remaining blob is small and rarely written, and one file keeps
  rollback/atomicity simple. The server still loads it fully into memory; "stub"
  means omit-from-projection — the bodies are served on hydration from memory. →
  Phases 4, 5.

## Generation

- **Decision 4a — Server owns all generation result writes** (remove the non-durable
  browser `generation-result` POST / "B2"). One persistence path before the SQLite
  move. → Phase 3.
- **Decision 4b — Persist the reroll buffer.** Rerolled candidates are persisted
  (on the `Chat`, as alternate message rows) so they survive disconnect, instead of
  the transient in-memory buffer. → Phase 6.
- **Auto-continue removed.** Off by default already; removing it makes durable
  `continue` a single append with no server-side chaining. → Phase 6.
- **continue commit = replace-with-full-extended** (matches today's computed text;
  idempotent on `generationId`). → Phase 6.
- **Decision 5 — Navigation stays client-side.** Active = the positioned `message[]`
  tail (durable for free); flipping candidates is display state. → Phase 6.
- **Reroll buffer is chat-level, cleared on `send`/`continue`, no order
  preservation.** Guarantee = "no rerolled result is lost." → Phase 6.

## Sync (the Q-series)

- **Q1 — Surgical sync uses the simple path.** Every command event already carries
  the monotonic revision (`server/fastify/src/commands/events.ts:3`) and the SSE
  frame has no `id:` line, so: optimistic-apply + revision-based echo-skip +
  refetch-on-gap. **No replay buffer, no client op-id.** → Phase 2. (This was the
  one open question worth locking up front; the code answered it.)
- **Q2 (table shape)** → resolved by Decision 2 (rows per message + `seq`).
- **Q3 (lorebook storage)** → resolved by Decision 3 (single `db.json`;
  stub-from-memory).
- **Q4 (continue commit + prefetch)** → replace-with-full-extended; persist prefetch
  into alternate rows.
- **Q5 (active selection durability)** → resolved by Decision 5 (active is the
  persisted tail; client-side navigation).

## Out of scope (recorded so it is not reopened by accident)

- Server-restart durability (durable-gen Milestone 2) — in-memory jobs stay.
- Per-message swipe history — the reroll buffer clears each turn.
- Stubbing settings/personas/presets/plugins — small + ubiquitous.
- Durable modes other than `send`/`continue`/`regenerate`.
