# Phase 4: Chat-Process Server Ownership

Date: 2026-05-29

Status: ACTIVE.

The remaining work: make the server own the chat process so the browser stays a
thin projection. This phase is driven entirely by the blocker classification —
the server must own anything that **decides or derives durable state** (the
assembled prompt, the LLM call, post-generation message/scriptstate mutations);
the browser may keep effects, transient UI, orchestration, and command issuance.

Today's default Fastify flow: the browser assembles the prompt
(`useServerPromptAssembly` defaults false), the server makes the LLM call
(unsupported providers hard-fail via `resolveServerCompletionRoute`), and the
browser orchestrates post-gen. When server prompt assembly is enabled, the
classifier makes supported sends server-mandatory and `/generate/chat` now
persists assembly-time scriptstate itself.

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
3. **A1 content classes, one batch each.** DONE: multimodal/asset inlining on
   image-input models; pluginV2 permanent unsupported; Lua `editRequest`,
   `editprocess`, input-trigger, and `editinput` for non-interactive Lua. OPEN:
   image-gen instruction. Each class graduates from `unsupported` to
   server-mandatory only after parity proof.
4. **A2 — server output-trigger + `editoutput`.** The server trigger engine is
   used for `'start'` and submit-time `'input'`, but `/generate/chat` has no
   post-generation `'output'` pass and runs no `editoutput` processing. Needs
   server output-script execution; sequence after A1's image-gen slice.

Group chat is **legacy** and removed elsewhere — do not add a server group model
here. See [`../status/sendchat-thinning.md`](../status/sendchat-thinning.md) for
the detailed A/B triage and [`../plan.md`](../plan.md) for the spine.

## Rule

One blocker item per batch. Name the browser branch, the server contract that
replaces it, and the proof the local fallback is gone. Do not mix A1 content
classes, A2, and group-chat removal in one review.
