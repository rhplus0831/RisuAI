# Phase 4 Reference

Date: 2026-05-29

Deep, code-grounded routing for carrying out
[`../phases/phase-4-sendchat-thinning.md`](../phases/phase-4-sendchat-thinning.md)
— server ownership of the chat process (A1 prompt-assembly parity + classifier,
C-A1 scriptstate persistence, A2 output-trigger/`editoutput`).

This is the canonical home for the **exact code coordinates** (signatures,
file:line anchors, parity matrix, the persistence round-trip, the test harness
mechanics) backing the higher-level routers. For the *why* and the A/B triage,
read those first; come here for the *where* and *exactly what the code does
today*:

- direction + blocker classification: [`../plan.md`](../plan.md)
- detailed A/B triage: [`../status/sendchat-thinning.md`](../status/sendchat-thinning.md)
- higher-level code entry points: [`../implementation-map.md`](../implementation-map.md)
- keep-vs-legacy-vs-unsupported: [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md)

Verify against the source before acting — line numbers drift; the symbol names
beside them are the stable handle. The codebase is the source of truth.

## Work order → reference doc

The Phase 4 batches, in order, and the doc that routes each into the code:

| # | Batch | Reference doc |
| --- | --- | --- |
| 1 | **A1 foundation** — build `resolveServerPromptAssembly`; make the supported text-send subset server-mandatory | [`prompt-assembly-classifier.md`](prompt-assembly-classifier.md) |
| 2 | **C-A1** — move assembly-time scriptstate persistence into `/generate/chat`; retire the command replay | [`post-generation-and-persistence.md`](post-generation-and-persistence.md) |
| 3 | **A1 content classes** (multimodal/asset, then Lua/plugin + input scripts, then image-gen) | [`server-assembler-parity.md`](server-assembler-parity.md) (server gaps) + [`local-assembler-content-classes.md`](local-assembler-content-classes.md) (browser branches) |
| 4 | **A2** — server output-trigger + `editoutput` | [`post-generation-and-persistence.md`](post-generation-and-persistence.md) |
| — | Proof for every batch (tests, fixtures, audit, verification commands) | [`proof-points.md`](proof-points.md) |

## Read order

1. [`prompt-assembly-classifier.md`](prompt-assembly-classifier.md) — the A1
   foundation: the `resolveServerCompletionRoute` precedent, the current
   `sendChat` gate and its **silent `unavailable` fall-through hole**, the runtime
   gates, and the target classifier shape + supported-subset definition.
2. [`server-assembler-parity.md`](server-assembler-parity.md) — what the server
   `/generate/chat` assembler does (AT PARITY) and the four content gaps
   (`NO_ASSETS`, identity `editRequest`, regex-only scripts, `'start'`-only
   triggers), the route contract, and the full `prompt/` file map.
3. [`local-assembler-content-classes.md`](local-assembler-content-classes.md) —
   the eight browser content branches (with the B1-vs-A1 split) that must be
   ported or classified `unsupported`.
4. [`post-generation-and-persistence.md`](post-generation-and-persistence.md) —
   the post-gen pipeline, the C-A1 persistence round-trip, the A2 durable
   derivations, and active-writer gating.
5. [`proof-points.md`](proof-points.md) — what each batch keeps green and adds.

## Orientation: today's default Fastify chat flow

Three independent boundaries gate the chat process (see [`../plan.md`](../plan.md)):

- **Prompt assembly** — gated by `useServerPromptAssembly` (default **off**), so
  the **browser assembles by default** (`assembleLocalSendChatPrompt`). Blocker
  **A1**; no `resolveServerPromptAssembly` classifier yet.
- **Provider dispatch** — server-routed in Fastify mode (platform-gated, no
  flag); unsupported shapes hard-fail via `resolveServerCompletionRoute`
  (blocker A3, already correct). This is the **classifier precedent for A1**.
- **Post-generation + persistence** — browser-orchestrated; durable writes flow
  through command routes the browser replays; the generation routes are
  **stateless w.r.t. the chat blob**. Blocker **A2** (output trigger +
  `editoutput`); **C-A1** moves assembly-time scriptstate persistence into the
  route.

Two facts that recur across these docs and are easy to get wrong:

- The current gate has a **silent local fallback**: `assembleServerBackedSendChat`
  can return `'unavailable'`, which `sendChat` does not handle, so it falls
  through to local assembly — and **no content signal (asset/image/Lua/plugin) is
  inspected on the server path at all**. The classifier must close both.
- There are **two scriptstate deltas**: the assembly-time delta (start trigger +
  run-var) which the server already computes and the browser replays (**C-A1**,
  no parity blocker), and the post-gen delta (output trigger + `editoutput`)
  which has **no server path** (**A2**). Do not conflate them.

## Scope discipline

One blocker item per batch. Name the browser branch, the server contract that
replaces it, and the proof the local fallback is gone. Do not mix A1 content
classes, A2, and group-chat removal in one review. Group chat is **legacy**
(client removal, separate task) — do not add a server group model. Update docs
after the code and proof land.
