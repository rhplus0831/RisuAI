# Lazy Projection Docs

Date: 2026-05-30

Status: PLANNED. No phase has started; this folder is the execution plan, not a
status record. The codebase is the source of truth; these docs route to it.

This directory is the active documentation set for the **lazy-projection**
workstream — the successor to [`client-thinning`](../archive/client-thinning/README.md)
and [`durable-generation`](../archive/durable-generation/README.md). Those two
closed workstreams made the **server own the chat process** (assembly, provider
call, post-generation derivation) and made a `send` **survive client disconnect**.
This workstream takes the next step on the same Fastify-only, single-writer
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

- **Lean projection (Phases 1–5).** Move the unbounded data (chat messages) into
  SQLite; ship *stubs* for chats / messages / lorebooks; hydrate on the explicit
  load point (open a chat, open a character, open a module). Make the SSE refresh
  **surgical** so hydrated entities are not clobbered.
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
