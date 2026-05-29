# Phase 4 Reference

Date: 2026-05-30

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
| 1 | **A1 foundation** — `resolveServerPromptAssembly` landed; supported subset is server-mandatory when the flag is on | [`prompt-assembly-classifier.md`](prompt-assembly-classifier.md) |
| 2 | **C-A1** — assembly-time scriptstate persistence lives in `/generate/chat` | [`post-generation-and-persistence.md`](post-generation-and-persistence.md) |
| 3 | **A1 content classes** — multimodal/asset, non-interactive Lua hooks, and image-gen instruction landed; non-vision caption, interactive Lua dialogs, and pluginV2 stay explicit unsupported | [`server-assembler-parity.md`](server-assembler-parity.md) + [`local-assembler-content-classes.md`](local-assembler-content-classes.md) |
| 4 | **A2** — server output-trigger + `editoutput` | [`post-generation-and-persistence.md`](post-generation-and-persistence.md) |
| — | Proof for every batch (tests, fixtures, audit, verification commands) | [`proof-points.md`](proof-points.md) |

## Read order

1. [`prompt-assembly-classifier.md`](prompt-assembly-classifier.md) — the landed
   A1 classifier, runtime gates, supported-subset definition, and the historical
   silent-fallback hole it closed.
2. [`server-assembler-parity.md`](server-assembler-parity.md) — what the server
   `/generate/chat` assembler and post-gen pass do at parity, explicit
   unsupported cases, the route contract, and the full `prompt/` file map.
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
  the **browser assembles by default** (`assembleLocalSendChatPrompt`). With the
  flag on, `resolveServerPromptAssembly` makes supported sends server-mandatory
  and hard-fails unsupported content.
- **Provider dispatch** — server-routed in Fastify mode (platform-gated, no
  flag); unsupported shapes hard-fail via `resolveServerCompletionRoute`
  (blocker A3, already correct). This is the **classifier precedent for A1**.
- **Post-generation + persistence** — browser-orchestrated for B1 effects and
  final-message command persistence. On the server-dispatch path,
  `/generate/chat` persists assembly-time scriptstate and A2 post-generation
  scriptstate deltas; final text / resend / revision ride `done.postGeneration`.

Two facts that recur across these docs and are easy to get wrong:

- The pre-slice-1 gate had a silent local fallback and did not inspect content
  signals. The landed classifier closed both; do not reintroduce an
  `unavailable`/local escape in Fastify mode with the flag on.
- There are **two scriptstate delta families**: assembly/submission-time
  mutations (start trigger, run-var, and submit-time input hooks), now persisted
  by `/generate/chat`, and the post-gen delta (output trigger + `editoutput`)
  now derived and persisted by `/generate/chat` on the server-dispatch path
  (**A2**). Do not conflate them.

## Scope discipline

For closeout work, keep group-chat removal, audit-rule hardening, event-patching,
and docs-only reconciliation in separate batches. Update docs after code and
proof land.
