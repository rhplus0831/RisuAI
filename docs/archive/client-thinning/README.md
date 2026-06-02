# Client Thinning Docs (ARCHIVED 2026-05-30)

> **ARCHIVED — workstream complete.** Moved from `docs/client-thinning/` to
> `docs/archive/client-thinning/` on 2026-05-30. The A-item blockers (A1/A2/A3) are
> landed, all eight Phase-5 closeout decisions are resolved, and the
> `pnpm client-thinning:audit` gate is green (23 checks / 58 tests). What the server
> now owns: prompt assembly (default-on `useServerPromptAssembly`), the supported
> text-send subset + multimodal/asset/image-gen content, the non-interactive Lua VM
> (editRequest/editprocess/editinput/input-trigger), the A2 post-generation pass
> (output trigger + `editoutput` + run-var), assembly-time + post-gen scriptstate
> persistence, and a single shared provider-capability table. The browser keeps B1
> effects, B2 orchestration/command-issuance, and renders the projection. Group chat's
> dead UI branches were removed (`A4R-group-chat-removed`). Remaining decisions and
> deferrals live in [`../../leftover.md`](../leftover.md); the current architecture
> is summarized in [`../../../STRUCTURE.md`](../../../STRUCTURE.md). These docs are kept
> as the design/decision record.

Date: 2026-05-30

This directory was the active documentation set for client thinning as its own
workstream. The project is a **Fastify-only** web variation: in Fastify-served
web mode the browser is a projection of server-owned durable state. It renders
UI, forwards user intent, applies server projections/events, runs browser-only
effects, and issues server commands for durable writes.

The folder structure is intentionally sharded so task agents can load only the
context they need. As of 2026-05-29 the **content was rewritten from scratch**
around a single spine: the _chat-process ownership blocker classification_. The
codebase is the source of truth; these docs route to it.

## The Spine: Server-Owned Chat Process

The work is organized around one question — _what blocks the server from owning
the chat process, and which cases are fine to leave in the browser?_ The A-item
implementation is now landed; closeout work remains.

- **A. Hard blockers** — must move server-side or be explicitly classified
  unsupported (never a silent browser fallback). A1 is landed: classifier,
  text-send subset, multimodal/asset inlining on vision models, non-interactive
  Lua edit/input hooks, and the image-gen instruction. A2 is landed on the
  server-dispatch path: the server runs the post-generation run-var pass,
  `'output'` trigger, and `editoutput`. A3 provider coverage hard-fails
  unsupported shapes.
- **B. Fine in the browser** — the browser triggers, plays, orchestrates, or
  _requests_ a write, but never owns durable state. B1 permanent client-owned,
  B2 acceptable-but-optimizable.
- **Legacy / removed** — no-port _and_ to be removed from the client. Group chat
  is now in this class; its dead `type === 'group'` UI branches were removed
  2026-05-30 (guarded by `A4R-group-chat-removed`).

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
10. [`phases/`](phases/README.md) — phase sequencing (0–4 A-items done; 5 closeout).
    Phase 4 slices 1, 2, 3a, 3b, 3c, and 4 are landed.
11. [`reference/`](reference/README.md) — deep, code-grounded routing for the
    Phase 4 batches (classifier, parity matrix, persistence round-trip, proof
    points).

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
