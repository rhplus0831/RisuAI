# Durable / Client-Independent Generation (DRAFT)

Date: 2026-05-29
Status: **DRAFT — planning in advance.** Not an active workstream. The client-thinning
agent is not pointed at this folder; links are one-directional (this → client-thinning),
so following client-thinning's docs never pulls an agent into this draft.

**Scope decided 2026-05-29:** Milestone 1 = **survive client disconnect only.**
Surviving a server *restart* mid-generation is a deferred Milestone 2 — that is the only
part that needs disk-persisted jobs.

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

Durable generation applies only to sends where:

- `resolveServerPromptAssembly(...) === 'server'` (server-assembled, server-routable
  provider, single non-group character, no asset / image-gen / Lua / plugin content), **and**
- **no post-gen A2 derivation** — no `runTrigger('output')` (this includes CBS/regex
  output triggers, which the *assembly* classifier does **not** screen) and no
  `editoutput`.

Out-of-subset sends keep today's connection-scoped flow, unchanged.

## Coverage ceiling — scripting (depends on the server Lua VM)

The subset excludes Lua/plugin content, so durable generation's real-world reach is
bounded by client-thinning's scripting decision (slice 3b):

- **Lua → committed server port.** Lua is the primary bot-extension mechanism and is
  widely used; client-thinning intends to stand up a server Lua VM (`wasmoon`) and
  port the Lua hooks. As each Lua arm reaches parity, Lua-scripted chats graduate into
  the server-assembled subset and therefore into durable-generation eligibility. This
  VM is the single biggest lever on coverage — a shared prerequisite, not an optional
  client-thinning sub-item.
- **plugin-V2 → permanent `unsupported`** (deprecated by Plugin V3; on the no-port
  list). plugin-V2-scripted chats stay outside server assembly and durable generation.
- **Regex + non-Lua trigger engine → already server-parity.** Unscripted and
  regex-scripted chats are eligible today.

End state: durable generation covers unscripted, regex-scripted, and — once the VM
lands — Lua-scripted single-character chats on server-routable providers, but not
plugin-V2-scripted chats. Lua hooks that call interactive APIs (`alertInput` etc.) may
stay client-bound even with the VM.

## Milestones and steps

**Milestone 1 — survive client disconnect (in-memory).**

- **Step 1 — pin the subset gate:** a `resolveDurableGeneration`-style classifier on
  top of `resolveServerPromptAssembly` + the post-gen exclusion above. Spec:
  [`steps/step-1-subset-gate.md`](steps/step-1-subset-gate.md).
- **Step 2 — decouple the lifecycle:** route `/generate/chat`'s provider stream through
  a generation `JobRegistry` instead of `req.raw.on('close') → abort`, for the subset.
  Return a jobId; let the client attach/reattach over SSE. (EC-D3 + the *lifecycle*
  half of EC-D1; full persistence is Step 3.) Spec:
  [`steps/step-2-lifecycle-decoupling.md`](steps/step-2-lifecycle-decoupling.md).
- **Step 3 — server-owned result persistence:** extend C-A1's route persistence from
  assembly-time scriptstate to the assistant result. (The *persistence* half of EC-D1,
  plus EC-D2, EC-D4.) Unblocked without slice 4 because the subset excludes the A2
  post-gen surface. Spec:
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
- **Registry wiring:** a dedicated generation `JobRegistry` + a transient
  `chatId → jobId` index, instantiated + GC-ticked in `app.ts` (Step 2).
- **Retention / GC:** reuse the proxy defaults — 30s done-grace, 64 active-job cap; the
  chat's submission lock clears at completion/cancel, not at GC (Step 2).
- **Modes:** `send` only for Milestone 1; `continue` / `regenerate` deferred.
- **Writer model:** authorize at **submission** (active writer required for persisting
  sends; preview exempt); **one running job per chat**; the result write is a
  server-owned completion of that authorized job (Step 2 §writer/job model, Step 3
  gotcha A).
- **Cancel policy:** generation runs until the user explicitly cancels (`DELETE`);
  cancel is authorized by the *current* active writer (handles writer handoff) (Step 2).
- **Resume after reload:** the transient `chatId → jobId` index is surfaced via the
  projection, so a returning client (even after a full reload) discovers + reattaches;
  observing is open, starting/cancelling need the writer lease (Step 2).

## Still open — locate before implementing

- **`/chat` writer/423 gate location:** the submission gate must hook into wherever
  `/chat` enforces the active writer today — the grep found no `activeWriter`
  enforcement in `generationChat.ts` / `mutations.ts`, so find it first. A code-location
  lookup, not a design decision.

---

Once stable, shard like `docs/client-thinning/` (router + shards). One doc while drafting.
