# Client Thinning Plan

Date: 2026-05-29

## Goal

Make the server own the chat process so the browser stays a thin projection. The
project is Fastify-only; durable writes go through server commands, import/asset/
generation/memory routes, or explicitly documented server-owned routes. The
browser renders, forwards intent, applies projections/events, runs browser-only
effects, and issues commands.

End state:

- Fastify owns durable data in `data/db.json`, `data/assets/`, `data/risu.db`,
  `data/save/`, backups, and auth files.
- The browser cannot mutate projected server state outside trusted projection
  writes or command-backed paths.
- The server decides/derives all durable chat state: the assembled prompt, the
  LLM call, and post-generation message/scriptstate mutations.
- The browser keeps only effects, transient UI, orchestration, and command
  issuance.
- Legacy features (group chat, and the historical no-port list) are removed, not
  merely unsupported.

## The Three Chat-Process Boundaries (current reality)

The chat process is not one toggle. Three independent boundaries gate it:

1. **Prompt assembly** — gated by the user flag `useServerPromptAssembly`
   (default **false**), so the DEFAULT is local/browser assembly.
2. **Provider dispatch (LLM call + credentials)** — gated by the platform marker
   `isFastifyServer`, with NO user flag, so the DEFAULT is server-routed via
   `/api/v1/generate/completion`. Unsupported providers fail hard; `local` only
   when `!isFastifyServer`.
3. **Post-generation + persistence** — always client-orchestrated; durable writes
   flow through command routes the browser triggers. The generation routes are
   stateless w.r.t. the chat blob.

So today's default Fastify flow is: **browser assembles the prompt, server makes
the LLM call, browser orchestrates post-gen, persistence via browser-issued
commands.** Flag history: `useServerGeneration` was a dead flag, removed
2026-05-29; `isFastifyServer` and `useServerPromptAssembly` are kept and
annotated in-code (not deprecated).

## The Blocker Classification (the work breakdown)

### A. Hard blockers — must move server-side or be explicitly classified unsupported

- **A1. Prompt-assembly content parity.** The server produces a *different
  prompt* than the browser for: multimodal/asset inlining (server `NO_ASSETS`,
  `inlayAssets` accepted-but-unused), Lua `editRequest` (server runs identity),
  and Lua/plugin-V2 script hooks (`editprocess`, plus input-trigger/`editinput`
  scripts at submit; server does regex scripts only). Assembly is all-or-nothing
  per send, so these cannot silently stay browser-side — port them or classify
  the send as server-unsupported. Foundational gap: there is no
  `resolveServerPromptAssembly` classifier (mirror `resolveServerCompletionRoute`)
  and `useServerPromptAssembly` defaults off.
- **A2. Post-generation durable derivation with no server path.** The **output
  trigger** (the server has no `'output'` trigger invocation at all — only
  `'start'` is wired) and **`editoutput` script processing** derive durable
  scriptstate/message mutations. Requires server-side script/trigger execution.
- **A3. Provider coverage.** Unsupported providers (NovelAI, Ooba, Plugin,
  WebLLM, non-vanilla OpenAI-compat) cannot be server-routed. Already handled
  correctly: `resolveServerCompletionRoute` returns `unsupported` and hard-fails
  (no browser fallback). A support cap, not a thinness leak.

### B. Fine to leave in the browser

- **B1. Permanent client-owned (server cannot do it; no-port).** Notification
  (Web/OS API), TTS playback, automatic image-generation call + inlay-screen
  rendering, emotion selection → transient `CharEmotion` store, HypaV3 progress
  UI, input plumbing (slash text, file-inlay insertion, say-nothing rows, reroll
  trim, abort), plugin runtime execution, rendering/UI state.
- **B2. Acceptable, browser orchestrates/requests (optimizable later, not a
  correctness problem).** Auto-continue/resend recursion (control flow that
  re-issues `sendChat`), result/scriptstate persistence via command replay
  (`dispatchPersistGenerationResult`/`dispatchPatchChatScriptstate`), and
  stage-timing metadata. Optional later wins: route-direct persistence closes a
  small durability window and saves a round-trip.

### Legacy / removed — no-port AND remove from the client

- **Group chat** (reclassified 2026-05-29): fully legacy. Not "unsupported under
  server assembly" — it must not remain usable from the client either. See
  [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md) for the
  removal item and code surface.
- The historical no-port list: native/mobile wrappers, Tauri/Hono/Express,
  service workers, peer sync, Google Drive sync, Risu Account Sync, SupaMemory/
  Hypa V2/Hanurai and removed memory engines, server-side plugin code execution,
  and per-event surgical projection patching without a separate event contract.

## Closed / Stable Areas

Treat as closed unless current source inventory proves drift: command boundary
and major resource command families, bootstrap projection and command-event
invalidation, `.risu` import/export/bundle routes, asset-byte routes and
reference validation baseline, backup/restore coverage, provider secret masking,
and Fastify provider dispatch for supported provider shapes.

## Out Of Scope Here: Durable-Generation Goal (Separate Workstream)

The owner's broader goal — the client only *sends a request*; the server keeps
processing if the client disconnects (does not treat it as failed) and persists the
result so a returning client can read the completed chat — is a **separate
workstream**, not part of this plan. Client-thinning moves *authority over the
correctness of state* server-side; it does not make the server own the *generation
lifecycle*. **Completing every blocker here (A1/A2/B) does not by itself reach that
goal** — and a closeout must not be read as reaching it. Today
`server/fastify/src/routes/generationChat.ts` aborts the provider call on client
disconnect (`req.raw.on('close')`) and the result is persisted by a browser command
replay; both are the opposite of durable generation.

Do **not** implement durable-generation work inside the Phase 4 slices. Its pieces
are partially ordered relative to this plan:

- **Lifecycle decoupling** (run generation as a `generationId`-keyed task that
  survives disconnect) is independent of A1/A2 — prototypable on its own.
- **Server-owned result persistence** is *gated on A2*: persisting the result
  server-side while the browser still derives `editoutput`/output-trigger mutations
  causes split-brain. Slice 2 (C-A1) moves *assembly-time* scriptstate persistence
  server-side — a prerequisite, not this goal.
- **A `generationId` job/read + reconnect contract** (status + accumulated output +
  `Last-Event-ID` replay or a read endpoint) replaces today's deferred SSE-reconnect
  gap.

Reference architecture: HypaV3 memory already runs as a server-side job with server
persistence and a transient browser progress projection.

## Near-Term Order

1. Run `pnpm client-thinning:audit`. If red, fix or triage before runtime work.
2. **A1 foundation:** build `resolveServerPromptAssembly` (server/local/unsupported)
   and make the supported text-send subset server-mandatory (single character,
   server-routable provider, no asset/image-gen/Lua/plugin content). This makes
   "the local fallback is gone" provable for that subset.
3. **C-A1 (post-gen, smallest, no parity blockers):** move assembly-time
   scriptstate persistence into `/generate/chat`; retire the command replay.
4. Port A1 content classes one batch at a time (multimodal, then Lua/plugin
   hooks), each graduating from `unsupported` to server-mandatory.
5. **A2:** server output-trigger + `editoutput` (needs server script execution).
6. **Group-chat legacy removal** (separate from thinning).
7. **Audit-rule hardening:** convert the 4 empirically-defeated needle-rules
   (A4R2, A4R7, fanout-svelte path, EC2) to AST invariants; add adversarial
   fixtures. See [`status/audit.md`](status/audit.md).
8. Keep **event patching deferred** until SSE reconnect/replay exists.

Each batch names one browser branch, the server contract that replaces it, and
the proof the local fallback is gone — and does not mix classes in one review.
