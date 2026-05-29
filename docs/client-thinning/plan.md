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
   mostly flow through command routes the browser triggers. Exception: server
   prompt assembly now persists the assembly-time scriptstate delta inside
   `/generate/chat`.

So today's default Fastify flow is: **browser assembles the prompt, server makes
the LLM call, browser orchestrates post-gen, final-message persistence via a
browser-issued command.** With server prompt assembly enabled, `/generate/chat`
also persists assembly-time scriptstate. Flag history: `useServerGeneration` was
a dead flag, removed 2026-05-29; `isFastifyServer` and
`useServerPromptAssembly` are kept and annotated in-code (not deprecated).

## The Blocker Classification (the work breakdown)

### A. Hard blockers — must move server-side or be explicitly classified unsupported

- **A1. Prompt-assembly content parity.** The classifier exists and, when
  `useServerPromptAssembly` is on, routes the supported text-send subset to the
  server and hard-fails out-of-subset sends instead of silently falling back.
  Multimodal/asset inlining is now at parity for image-input models. Remaining
  gaps are: non-vision image caption fallback (explicit unsupported), image-gen
  view instruction (slice 3c), and Lua hook wiring (`editRequest`,
  `editprocess`, input-trigger/`editinput`). The server Lua VM runtime exists,
  but these hooks are not wired. PluginV2 edit/replacer hooks are permanent
  unsupported because server-side plugin code execution is no-port. The flag
  still defaults off, so browser assembly is the default production path.
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
  re-issues `sendChat`), final-message persistence via
  `dispatchPersistGenerationResult`, and stage-timing metadata. Assembly-time
  scriptstate replay is no longer in this bucket: C-A1 moved it into
  `/generate/chat`. Optional later wins: route-direct final-result persistence
  closes a small durability window and saves a round-trip.

### Legacy / removed — no-port AND remove from the client

- **Group chat** (reclassified 2026-05-29): fully legacy. Not "unsupported under
  server assembly" — it must not remain usable from the client either. See
  [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md) for the
  removal item and code surface.
- The historical no-port list: native/mobile wrappers, Tauri/Hono/Express,
  service workers, peer sync, Google Drive sync, Risu Account Sync, legacy memory
  engines/sync surfaces outside this thinning plan, server-side plugin code
  execution, and per-event surgical projection patching without a separate event
  contract. Any live compatibility/migration surface needs a dedicated removal or
  migration task; do not port it as part of client thinning.

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
2. Continue **A1 content graduation** one batch at a time:
   - Lua sub-slice 2: wire VM-backed `editRequest`.
   - Lua sub-slice 3: wire/prove `editprocess`.
   - Lua sub-slice 4: add submit-time input-trigger/`editinput`.
   - Slice 3c: port the image-gen view instruction.
3. **A2:** server output-trigger + `editoutput` (needs server script execution).
4. **Group-chat legacy removal** (separate from thinning).
5. **Audit-rule hardening:** convert the 4 empirically-defeated needle-rules
   (A4R2, A4R7, fanout-svelte path, EC2) to AST invariants; add adversarial
   fixtures. See [`status/audit.md`](status/audit.md).
6. Keep **event patching deferred** until SSE reconnect/replay exists.

Each batch names one browser branch, the server contract that replaces it, and
the proof the local fallback is gone — and does not mix classes in one review.
