# Durable / Client-Independent Generation (DRAFT)

Date: 2026-05-29
Status: **DRAFT — planning in advance.** Not an active workstream. The client-thinning
agent is not pointed at this folder; links are one-directional (this → client-thinning),
so following client-thinning's docs never pulls an agent into this draft.

**Scope decided 2026-05-29:** Milestone 1 = **survive client disconnect only.**
Surviving a server *restart* mid-generation is a deferred Milestone 2 — that is the only
part that needs disk-persisted jobs.

## Decisions (2026-05-30)

Owner decisions refining this draft:

1. **Sequencing — client-thinning prerequisites landed.** Provider-resolver
   unification (client-thinning closeout decision #5) and the
   `useServerPromptAssembly` default-on flip (closeout decision #1) both landed on
   2026-05-30. Durable-generation M1 is no longer blocked on those batches, but it
   remains a separate draft workstream.
2. **M1 coverage INCLUDES the A2 post-gen path.** The subset is widened to include
   output triggers and `editoutput` (the draft previously excluded them). This is now
   feasible because client-thinning **slice 4 (A2) landed**: the durable job runs the
   server post-gen pass (`runServerPostGeneration`) at completion and persists the
   *derived* final text + scriptstate delta. Consequence: Step 1 drops its two
   post-gen exclusions, and Step 3 now **depends on** slice 4 (landed) and runs the
   A2 pass server-side (it is no longer the "sidesteps A2" narrow case).
3. **M1 stays disconnect-only (in-memory).** Surviving a server *restart* remains
   Milestone 2. Rationale: a single-user self-host server, and a chat generation is
   not a long-running job — the in-memory job window is short, so restart-survival is
   low-value for now.

Resolved during the docs audit: the `/chat` writer/423 gate is already the global
active-writer guard in `server/fastify/src/activeWriter.ts`; `isServerOwnedMutation`
includes `POST /api/v1/generate/chat` and `/api/v1/generate/preview-prompt`.
Remaining open/ambiguous tasks live in [`../deferred.md`](../deferred.md).

## Goal

The client only *sends a request*. From there the server owns the generation:

1. **Survives client disconnect** — the server keeps generating and does not fail the
   request when the browser closes / the network drops.
2. **Result is durable** — the completed assistant turn (+ any derived scriptstate)
   persists server-side, without the client.
3. **Resumable** — a returning client reattaches to a running generation or reads a
   completed one.

## Relationship to client-thinning (prerequisite, not the same goal)

Client-thinning moves *authority over the correctness of state* server-side; this
workstream moves *ownership of the generation lifecycle*. **Completing client-thinning
(A1/A2/B) does not by itself reach this goal.** But A1 (server prompt assembly) and A2
(server post-gen derivation) are **prerequisites** — "the client only sends a request"
needs both. Reverse-direction marker: `docs/client-thinning/plan.md` "Out Of Scope Here".

## Existing primitives — what we build on (re-grounded 2026-05-29)

The draft's original "mirror HypaV3 memory" was only half right. There are **two**
precedents, each covering a different half:

### A. `JobRegistry` / streamJobs — the live-streaming + reconnect precedent

`server/fastify/src/streamJobs.ts` already implements a detached, reconnectable
streaming job — today used only by the local-LLM proxy (`routes/streamJobs.ts`,
`POST /api/v1/proxy/stream-jobs`):

- Runs on the **job's** `AbortController`, not the request connection — survives client
  disconnect (`runStreamJob` `streamJobs.ts:264`; the WS close handler calls `detach`,
  not abort, `routes/streamJobs.ts:191`).
- **Buffers** events when no client is attached (`pushEvent` `:165`) and **replays**
  them on reconnect (`attach` `:186`); done jobs linger 30s (`markDone` `:207`).
- **Fire-and-forget create** returns `{ jobId }` (`routes/streamJobs.ts:135-148`); the
  client attaches later over WebSocket `…/:id/ws`.

Reusable: the **`JobRegistry` class** (create / pushEvent / attach / detach / markDone /
tickGc). NOT reusable: `runStreamJob` — it's a URL proxy gated to local hosts via
`sanitizeLocalTargetUrl`. Generation needs its own runner that drives the provider
dispatch and pushes token events into a job.
Bounds: **in-memory** (lost on restart — exactly why restart is Milestone 2), proxy-
scoped, and it does not persist results. For Milestone 1 (disconnect-only) the in-memory
behavior is sufficient.

### B. Result persistence — the command/mutation machinery (+ in-flight C-A1)

Today the result is persisted by the **browser** replaying commands
(`persistServerBackedGenerationResult` → `dispatchPersistGenerationResult`). Slice 2
(C-A1, **landed** — `654db21a`) moves *assembly-time* scriptstate persistence into
`/generate/chat`.
Durable generation extends that same move to the **result** (the assistant message), so
it persists without the browser — the bridge to "read the completed chat later" with no
new disk job store in Milestone 1.

### C. `resolveServerPromptAssembly` — the subset-gate template

Slice 1's classifier (`src/ts/process/request/serverPromptAssembly.ts`) returns
`local | server | unsupported`. Durable generation defines its supported subset as a
restriction of this (below) and likewise never silently downgrades.

## Supported subset (the drift fence)

Durable generation applies to sends where:

- `resolveServerPromptAssembly(...).type === 'server'` (server-assembled,
  server-routable provider, single non-group character, default-on server assembly
  flag, no non-vision caption fallback, no interactive Lua dialog APIs, no pluginV2
  edit/replacer hooks). Image-input multimodal/asset content, the image-gen view
  instruction, and non-interactive Lua edit/input hooks are in-subset because the
  relevant client-thinning slices have landed.

Post-gen A2 derivation (`runTrigger('output')` incl. CBS/regex output triggers, and
`editoutput`) is **in-subset as of decision #2 (2026-05-30)** — the durable job runs
the server post-gen pass at completion and persists the derived result (see Step 3).
The draft's earlier "no post-gen derivation" exclusion is removed because slice 4 (A2)
landed.

Out-of-subset sends keep today's connection-scoped flow, unchanged.

## Coverage ceiling — scripting

The subset now inherits non-interactive Lua support from client-thinning's
server-assembly gate. Its remaining scripting ceiling is pluginV2 and interactive
Lua dialogs:

- **Lua → server port landed for non-interactive edit/input hooks.** Lua is the
  primary bot-extension mechanism and is widely used; the server Lua VM (`wasmoon`)
  and prompt-assembly hooks have landed. Non-interactive Lua-scripted
  single-character chats are eligible when the rest of the assembly gate returns
  `server`.
- **plugin-V2 → permanent `unsupported`** (deprecated by Plugin V3; on the no-port
  list). plugin-V2-scripted chats stay outside server assembly and durable generation.
- **Regex + non-Lua trigger engine → already server-parity.** Unscripted and
  regex-scripted chats are eligible today.

End state for Milestone 1: durable generation covers unscripted, regex-scripted,
and non-interactive Lua-scripted single-character chats on server-routable providers,
but not pluginV2-scripted chats or Lua hooks that call interactive APIs
(`alertInput` etc.).

## Milestones and steps

**Milestone 1 — survive client disconnect (in-memory).**

- **Step 1 — pin the subset gate:** a `resolveDurableGeneration`-style classifier on
  top of `resolveServerPromptAssembly` (per decision #2, no separate post-gen
  exclusion — output triggers / `editoutput` are in-subset). Spec:
  [`steps/step-1-subset-gate.md`](steps/step-1-subset-gate.md).
- **Step 2 — decouple the lifecycle:** route `/generate/chat`'s provider stream through
  a generation `JobRegistry` instead of `req.raw.on('close') → abort`, for the subset.
  Return a jobId; let the client attach/reattach over SSE. (EC-D3 + the *lifecycle*
  half of EC-D1; full persistence is Step 3.) Spec:
  [`steps/step-2-lifecycle-decoupling.md`](steps/step-2-lifecycle-decoupling.md).
- **Step 3 — server-owned result persistence:** at job completion, run the A2 server
  post-gen pass (`runServerPostGeneration`, slice 4, landed) and extend C-A1's route
  persistence from assembly-time scriptstate to the *derived* assistant result +
  post-gen scriptstate delta. (The *persistence* half of EC-D1, plus EC-D2, EC-D4.)
  Now depends on slice 4 (per decision #2). Spec:
  [`steps/step-3-server-owned-result-persistence.md`](steps/step-3-server-owned-result-persistence.md).

**Milestone 2 — survive server restart (deferred).** Disk-persist job state/result;
HypaV3's `memoryRepository` / `routes/memoryJobs.ts` is the precedent to study then. Out
of scope until Milestone 1 lands.

## Exit criteria (Milestone 1)

- **EC-D1** — drop the client mid-stream; the generation completes and the result lands
  in `db.json`.
- **EC-D2** — a returning client reads the completed result by jobId / generationId.
- **EC-D3** — a client reattaches to an in-flight generation and receives the remaining
  tokens.
- **EC-D4** — no browser command-replay is required for the result to persist.

## Resolved in the step specs

- **Reattach transport:** SSE + `jobId` reattach (Step 2) — keeps the existing event
  vocabulary and client parser; no WebSocket.
- **Registry wiring:** a dedicated generation `JobRegistry` + a server-memory
  `chatId → jobId` index, instantiated + GC-ticked in `app.ts` (Step 2). Bootstrap
  should expose the index as `activeGenerationJobs` entries shaped
  `{ chatId: string; jobId: string }` so reload-resume has a concrete wire shape.
- **Retention / GC:** reuse the proxy defaults — 30s done-grace, 64 active-job cap; the
  chat's submission lock clears at completion/cancel, not at GC (Step 2).
- **Modes:** `send` only for Milestone 1; `continue` / `regenerate` deferred.
- **Writer model:** authorize at **submission** using the existing active-writer
  guard for `/generate/chat`; **one running job per chat**; the result write is a
  server-owned completion of that authorized job (Step 2 §writer/job model, Step 3
  gotcha A). Today the guard also covers `/generate/preview-prompt`; durable M1 is
  send-only, so preview exemption is not part of the current implementation scope.
- **Cancel policy:** generation runs until the user explicitly cancels (`DELETE`);
  cancel is authorized by the *current* active writer (handles writer handoff) (Step 2).
- **Resume after reload:** the transient `activeGenerationJobs` projection is surfaced
  by bootstrap, so a returning client (even after a full reload) discovers +
  reattaches; observing is open, starting/cancelling need the writer lease (Step 2).

## Still Open / Ambiguous Before Implementation

- **Durable post-gen failure policy:** Step 3 still needs to decide whether a
  thrown durable-job `runServerPostGeneration` persists raw provider text with a
  warning or records a job error.
- **Modes beyond `send`:** `continue` and `regenerate` remain out of M1 and need
  their own idempotency/append semantics before widening.
- **Event patching / replay contract:** surgical projection patching remains outside
  this work until SSE reconnect + replay semantics are specified.

---

Once stable, shard like `docs/client-thinning/` (router + shards). One doc while drafting.
