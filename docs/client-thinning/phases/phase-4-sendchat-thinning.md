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
browser orchestrates post-gen with persistence via browser-issued commands.

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

1. **A1 foundation — prompt-assembly classifier.** Build
   `resolveServerPromptAssembly` (`server | local | unsupported`, mirroring
   `resolveServerCompletionRoute`) and replace the `useServerPromptAssembly`
   runtime gate. Make the supported text-send subset server-mandatory (single
   non-group character, server-routable provider, no asset/image-gen/Lua/plugin
   content). Proof: `assembleLocalSendChatPrompt` is unreachable for the subset.
2. **C-A1 — server-side scriptstate persistence.** Move assembly-time chat-var
   persistence into `/generate/chat`; retire the command replay. No parity
   blocker; the smallest real post-gen batch.
3. **A1 content classes, one batch each** — multimodal/asset inlining, then
   Lua `editRequest` + Lua/plugin-V2 + input-trigger/`editinput` scripts, then
   the image-gen instruction. Each graduates its send shape from `unsupported`
   to server-mandatory — never a silent local fallback.
4. **A2 — server output-trigger + `editoutput`.** The server has no `'output'`
   trigger invocation (only `'start'` is wired) and runs no `editoutput`
   processing. Needs server output-script execution; sequence after A1's
   Lua/plugin parity.

Group chat is **legacy** and removed elsewhere — do not add a server group model
here. See [`../status/sendchat-thinning.md`](../status/sendchat-thinning.md) for
the detailed A/B triage and [`../plan.md`](../plan.md) for the spine.

## Rule

One blocker item per batch. Name the browser branch, the server contract that
replaces it, and the proof the local fallback is gone. Do not mix A1 content
classes, A2, and group-chat removal in one review.
