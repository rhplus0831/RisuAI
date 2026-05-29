# Client Thinning Docs

Date: 2026-05-29

This directory is the active documentation set for client thinning as its own
workstream. The project is a **Fastify-only** web variation: in Fastify-served
web mode the browser is a projection of server-owned durable state. It renders
UI, forwards user intent, applies server projections/events, runs browser-only
effects, and issues server commands for durable writes.

The folder structure is intentionally sharded so task agents can load only the
context they need. As of 2026-05-29 the **content was rewritten from scratch**
around a single spine: the *chat-process ownership blocker classification*. The
codebase is the source of truth; these docs route to it.

## The Spine: Server-Owned Chat Process

The remaining work is defined by one question — *what blocks the server from
owning the chat process, and which cases are fine to leave in the browser?* Every
remaining batch is one item from this classification:

- **A. Hard blockers** — must move server-side or be explicitly classified
  unsupported (never a silent browser fallback). A1 now has its classifier,
  the text-send subset, and multimodal/asset inlining on vision models; the
  remaining A1 work is Lua hook wiring and the image-gen instruction. A2
  post-generation durable derivation remains open. A3 provider coverage hard-
  fails unsupported shapes.
- **B. Fine in the browser** — the browser triggers, plays, orchestrates, or
  *requests* a write, but never owns durable state. B1 permanent client-owned,
  B2 acceptable-but-optimizable.
- **Legacy / removed** — no-port *and* to be removed from the client. Group chat
  is now in this class.

The dividing line: the server must own anything that **decides or derives durable
state** (the assembled prompt, the LLM call, post-generation message/scriptstate
mutations). The browser may keep effects, transient UI, orchestration, and
command-issuance. See [`plan.md`](plan.md) for the full breakdown.

## Read Order

1. [`note.md`](note.md) — short handoff for the next agent.
2. [`status.md`](status.md) — current snapshot and status router.
3. [`plan.md`](plan.md) — goal, the blocker classification, and work order.
4. [`status/sendchat-thinning.md`](status/sendchat-thinning.md) — the detailed
   chat-process ownership triage (A/B per branch).
5. [`implementation-map.md`](implementation-map.md) — code entry points,
   contracts, and proof points.
6. [`runtime-stages.md`](runtime-stages.md) — projection-stage boundaries.
7. [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md) —
   permanent client-owned behavior and the legacy/removed list (incl. group chat).
8. [`coverage.md`](coverage.md) — test/audit coverage router.
9. [`architecture.md`](architecture.md) — module ownership and complexity.
10. [`phases/`](phases/README.md) — phase sequencing (0–3 done; 4 active; 5 closeout).
    Phase 4 slices 1, 2, and 3a are done; 3b has the Lua VM runtime landed
    with hooks pending.
11. [`reference/`](reference/README.md) — deep, code-grounded routing for the
    active Phase 4 batches (classifier, parity matrix, persistence round-trip,
    proof points).

## Canonical Detail

- Direction and work breakdown: [`plan.md`](plan.md).
- Detailed chat-process ownership triage: [`status/sendchat-thinning.md`](status/sendchat-thinning.md).
- Code entry points and proof commands: [`implementation-map.md`](implementation-map.md).
- Phase 4 code-level detail (per work-order item): [`reference/`](reference/README.md).
- Client-owned vs legacy/removed: [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md).
- Latest recorded verification: [`coverage/latest-verification.md`](coverage/latest-verification.md).

## Maintenance Rules

- Keep one canonical home per claim; routers summarize and link only.
- A runtime change updates the invariant/audit/proof and the smallest relevant
  shard in the same batch, and docs after the code and proof are complete.
- Use the repository commit convention (`feat:`, `fix:`, `refactor:`).
