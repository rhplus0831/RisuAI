# Lazy Projection Plan

Date: 2026-05-30

## Goal

Make the browser a **lean, lazily-hydrated, reconnectable** view of server-owned
durable state, and finish **durable generation** across all generation modes. The
project is Fastify-only and single-writer (enforced by the active-writer lease,
`423 active_writer_stale`); that single-writer invariant is what makes the
surgical-sync and reroll designs tractable without conflict resolution.

End state:

- The bootstrap projection ships **stubs** for chats, messages, and lorebooks; the
  client hydrates an entity on its explicit load point (open chat / open character
  / open module) and never holds the whole corpus at once.
- Chat **messages** live in a SQLite table (one row per message), not embedded in
  `data/db.json`. A single message append no longer rewrites the whole JSON blob.
- The SSE command-event refresh is **surgical**: the writer skips the refetch for
  its own echoed change (reconciling by revision) and does a targeted fetch only
  for foreign events or a detected revision gap. The full-bootstrap refetch
  becomes the gap/reconnect fallback, not the per-event default.
- Generation is durable for `send`, **`continue`, and `regenerate`**; rerolled
  results are never lost (a chat-level reroll buffer survives disconnect); a
  reloaded browser can re-attach to a live in-flight generation.

Non-goals are listed under [Out Of Scope](#out-of-scope).

## Locked Decisions

Full rationale in [`reference/decisions.md`](reference/decisions.md). Summary:

- **Storage (Decision 3).** Keep a **single** `data/db.json`, loaded fully into
  server memory, and move chat **messages** out to SQLite — messages are the
  unbounded, high-churn part, so the remaining blob stays small and rarely
  rewritten.
- **Message table (Decision 2 + refinements).** Messages get their own SQLite
  table: `uid` PK (the existing per-message id, today stored confusingly as
  `Message.chatId`), `chat_id` FK (the chat's `Chat.id`), an explicit `seq`
  ordering column, and the message fields. Reroll alternates are rows in the same
  table flagged as alternates (no active `seq`) — not a JSON array. See
  [`reference/storage-model.md`](reference/storage-model.md).
- **Surgical sync (Q1 → simple).** Every command event already carries the
  monotonic `revision` (`server/fastify/src/commands/events.ts:3`); the SSE frame
  has no `id:` line, so there is **no replay buffer and no client op-id** — use
  revision-based echo-skip + refetch-on-gap. See
  [`reference/surgical-sync.md`](reference/surgical-sync.md).
- **Stub scope.** Stub only chats/messages, character `globalLore`, and module
  `lorebook`. Enabled modules' display parts stay resident. Everything else stays
  fully projected. See [`reference/stub-hydration.md`](reference/stub-hydration.md).
- **Durable modes (Decisions 1, 4a, 4b, 5).** Remove auto-continue;
  `continue` = replace-with-full-extended on commit; `regenerate` adds an
  alternate row + makes it active; reroll buffer is **persisted** on the `Chat`
  and cleared on `send`/`continue`; navigation between candidates stays
  client-side (active = the positioned tail, durable for free). See
  [`reference/durable-generation-modes.md`](reference/durable-generation-modes.md).

## Phase Order And Dependencies

Detailed in [`phases/README.md`](phases/README.md). The order is **not** the order
the items were first proposed — surgical sync was pulled ahead of stub-loading
because it is a prerequisite.

| # | Phase | Depends on |
| - | ----- | ---------- |
| 1 | Asset GC → server | — (independent) |
| 2 | Surgical inbound sync | — (prerequisite for 4, 5) |
| 3 | Unify generation persistence (server owns all result writes) | — (eases 4; precondition for clean 6) |
| 4 | Chats/messages → SQLite + stub-load | 2; eased by 3 |
| 5 | Lorebooks (globalLore + module lorebook) stub | 2; shares `lorebookBridge` rework with 4 |
| 6 | Durable continue/regenerate + reroll buffer | 3; best after 4 |
| 7 | Browser auto-reattach | durable `send` (exists); movable |

**The one hard rule: Phase 2 before Phases 4 and 5.**

## Out Of Scope

- **Server-restart durability (durable-gen Milestone 2).** Generation jobs stay
  in-memory; restart-survival via disk-persisted jobs is deferred (low value for
  single-user self-host).
- **Per-message swipe history.** The reroll buffer clears each turn; alternates
  for past messages are intentionally not retained (consistent with today's
  `Message` having no swipe field).
- **Stubbing settings/personas/presets/plugins.** Small and ubiquitously read at
  startup; not worth lazy-loading.
- **Modes other than `send`/`continue`/`regenerate`** for durable generation.
