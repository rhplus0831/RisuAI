# Lazy Projection Docs (ARCHIVED 2026-05-30)

Date: 2026-05-30

> **ARCHIVED — implemented, excluding lorebook stub.** Moved from
> `docs/lazy-projection/` to `docs/archive/lazy-projection/` after a source/history
> audit. The workstream delivered server-side asset GC; surgical inbound projection
> sync; server-owned generation result writes; SQLite-backed chat messages and
> per-chat `hypaV3Data`; chat-stub bootstrap plus hydrate-on-open; durable `send`,
> `continue`, and `regenerate`; persisted reroll alternates; and browser
> auto-reattach to in-flight durable jobs. The lorebook-stub item is deliberately
> outside this audit and remains opt-in/experimental. Server-restart durability
> remains out of scope. The phase files retain their original PLANNED framing.
> Verification: `pnpm api:test -- ...` (77 files / 1,388 tests) and
> `pnpm test -- ...` (89 files / 1,013 passed / 4 skipped).

Status: **ARCHIVED.** These docs are the historical execution plan and decision
record; the codebase is the source of truth.

This directory was the active documentation set for the **lazy-projection**
workstream — the successor to [`client-thinning`](../client-thinning/README.md) and
[`durable-generation`](../durable-generation/README.md). Those two closed
workstreams made the **server own the chat process** (assembly, provider call,
post-generation derivation) and made a `send` **survive client disconnect**. This
workstream took the next step on the same Fastify-only, single-writer
architecture.

## The Spine: A Lean, Reconnectable Client View

One sentence: **the client receives a lean, lazily-hydrated projection of
server-owned durable state, and the server owns durable, resumable generation
across all modes.**

Today the browser receives the *entire* `Database` blob at bootstrap and
re-fetches all of it on every command event (debounced full refetch +
`setDatabase` replace, `src/ts/bootstrap.ts:156-166`). The heavy, unbounded part
of that blob is chat history (`character.chats[].message[]`), and a command that
appends one message rewrites the entire `data/db.json` on disk
(`server/fastify/src/repository.ts:100-105`). This workstream removes both the
wire cost and the write cost, and finishes durable generation:

- **Lean projection (Phases 1–5, original plan).** Move the unbounded data (chat
  messages) into SQLite; ship *stubs* for chats / messages / lorebooks; hydrate on
  the explicit load point (open a chat, open a character, open a module). This archive
  audit excludes the lorebook-stub item. Make the SSE refresh **surgical** so hydrated
  entities are not clobbered.
- **Durable generation completion (Phases 6–7).** Extend durability from `send` to
  `continue` and `regenerate` (with a chat-level reroll buffer), and let a
  reloaded browser **re-attach** to a live in-flight generation.

The dividing line is unchanged from client-thinning: the **server owns durable
state**; the browser renders, forwards intent, applies projections/events, runs
browser-only effects, and issues commands. What changes here is *how much* the
browser holds and receives, and *how completely* generation survives a
disconnect.

## Read Order

1. [`note.md`](note.md) — short handoff for the next agent.
2. [`plan.md`](plan.md) — goal, locked decisions, phase order, dependencies,
   out-of-scope.
3. [`architecture.md`](architecture.md) — the post-workstream storage model,
   ownership boundaries, and the seams each phase touches.
4. [`phases/`](phases/README.md) — the seven phases in dependency order, one file
   each (goal / changes / seams / risks / exit criteria).
5. [`reference/`](reference/README.md) — deep, code-grounded design references:
   the storage model, the surgical-sync contract, the stub/hydration model, the
   durable-generation-modes design, and the locked decisions.

Status and coverage shards (per the `client-thinning` pattern) are intentionally
**not** created yet; they accrue as phases execute.
