# Phase 4: Chat-Process Server Ownership

Date: 2026-05-30

Status: DONE for A1/A2 implementation.

This phase made the server own the chat-process blocker set so the browser stays
a thin projection. It is driven by the blocker classification —
the server must own anything that **decides or derives durable state** (the
assembled prompt, the LLM call, post-generation message/scriptstate mutations);
the browser may keep effects, transient UI, orchestration, and command issuance.

Today's default Fastify flow: `/generate/chat` assembles the prompt, makes the LLM
call (unsupported providers hard-fail via the shared provider-capability table),
persists assembly-time scriptstate, and owns the server-dispatch post-generation
derivation. The browser applies streaming/effects and still issues the
final-message persistence command. Local assembly is now an explicit opt-out for
tests/specific cases or non-Fastify mode.

The code-level detail for each batch below — exact entry points and signatures,
the server/browser parity matrix, the persistence round-trip, and the proof
points — is organized under [`../reference/`](../reference/README.md), one shard
per work-order item.

## Work Order

Each item is expanded into a step-by-step **slice** under
[`slices/`](slices/README.md) — the ordered procedure (what to read, what to
change, and what to prove, in order) for carrying out one batch. Mapping: item 1 →
[`slice-1`](slices/slice-1-a1-foundation-classifier.md); item 2 →
[`slice-2`](slices/slice-2-c-a1-scriptstate-persistence.md); item 3 →
[`slice-3a`](slices/slice-3a-content-multimodal-asset.md) /
[`3b`](slices/slice-3b-content-lua-plugin-scripts.md) /
[`3c`](slices/slice-3c-content-image-gen-instruction.md); item 4 →
[`slice-4`](slices/slice-4-a2-output-trigger-editoutput.md). The slices' README
explains the **graduation model** that links them (slice 1 makes every content
class `unsupported`; 3a/3b/3c each flip one to `server`).

1. **DONE: A1 foundation — prompt-assembly classifier.**
   `resolveServerPromptAssembly` is landed; the supported subset is
   server-mandatory when the flag is on.
2. **DONE: C-A1 — server-side scriptstate persistence.** `/generate/chat`
   persists assembly-time chat-var deltas and returns the bumped revision.
3. **DONE: A1 content classes, one batch each.** Multimodal/asset inlining on
   image-input models, pluginV2 permanent unsupported, non-interactive Lua
   `editRequest` / `editprocess` / input-trigger / `editinput`, and the image-gen
   instruction are all landed. Remaining unsupported cases are explicit:
   non-vision caption fallback, interactive Lua dialogs, and pluginV2.
4. **DONE: A2 — server output-trigger + `editoutput`.** Slice 4 runs the
   post-generation run-var pass, `runTrigger(..., 'output', ...)`, and
   `editoutput` server-side on the server-dispatch path, persists the scriptstate
   delta, and removes the browser durable derivation for that path.

Group chat is **legacy** and tracked elsewhere for client removal — do not add a
server group model here. See
[`../status/sendchat-thinning.md`](../status/sendchat-thinning.md) for the
detailed A/B triage and [`../plan.md`](../plan.md) for the spine.

## Rule

For any reopened or follow-up batch, name the browser branch, the server contract
that replaces it, and the proof the local fallback is gone. Do not mix
chat-process thinning with group-chat removal in one review.
