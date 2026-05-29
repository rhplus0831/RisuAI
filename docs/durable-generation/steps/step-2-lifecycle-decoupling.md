# Step 2 (Milestone 1): decouple the generation lifecycle (SSE + jobId reattach)

Date: 2026-05-29
Status: **DRAFT spec** — durable-generation workstream (`../README.md`), Milestone 1
(disconnect-only). Transport: **SSE + jobId reattach** (reuse `JobRegistry`).
**Lands together with Step 3** — Fastify has no users, so there is no interim
browser-persist path to preserve. Writer/job model resolved 2026-05-29 (below).

| | |
| --- | --- |
| **Workstream / milestone / step** | Durable generation · Milestone 1 · Step 2 (with Step 3) |
| **Depends on** | **Step 1** (`resolveDurableGeneration`) — wired here for the first time |
| **Reuses** | `server/fastify/src/streamJobs.ts` (`JobRegistry`); `routes/streamJobs.ts` (create/run/attach/DELETE pattern) |
| **Touches** | `routes/generationChat.ts`, `app.ts` (registry wiring), the browser SSE consumer (`request/serverChat*.ts`) |
| **Goal** | Run a durable-subset generation as a `JobRegistry` job whose lifecycle is **not** tied to the request connection, streamed over SSE, with a `jobId` reattach endpoint. Survive disconnect + reattach (incl. after a full reload). **Persistence is server-owned (Step 3, landing together).** |

## EC mapping

**Steps 2 and 3 land together as one unit** (Fastify has no users — no interim
browser-persist to preserve; see the `fastify-no-users` directive). Together they
close EC-D1/D2/D3/D4. Split of responsibility:

- **Step 2:** EC-D3 (reattach to an in-flight generation, receive the remaining
  events) **and the lifecycle half of EC-D1** (the generation runs to completion
  server-side despite disconnect).
- **Step 3:** the persistence half of EC-D1 (result persisted with **no** reconnect),
  EC-D2, EC-D4. The result is **always** server-persisted; the browser never persists.

## The core inversion

Today (`generationChat.ts`): one `POST` opens an SSE stream, `attachAbort` (`:137`)
wires `req.raw.on('close', () => controller.abort())`, and the whole assemble →
dispatch → chunk → done flow runs inline on `reply` (`streamAssembly`, `:240`).
**Disconnect = abort = everything lost.**

Step 2: the generation becomes a detached `JobRegistry` job. The request connection
is just *a viewer* of the job's event stream — dropping it detaches the viewer; the
job keeps running and buffers. Mirror `routes/streamJobs.ts`'s
create → `void run…` → attach shape.

## Writer / job model (resolved)

The active-writer model's purpose (no write conflicts) is preserved by moving the
check to **submission** and adding a **one-job-per-chat** rule:

- **Authorize at submission.** A persisting send (`send`/`continue`/`regenerate`)
  requires the caller to be the **active writer** — reject otherwise. `preview` /
  `preview_prompt` don't write and are exempt.
- **One running job per chat — no exception, even for the active writer.** Enforced via
  a transient **`chatId → jobId` index** (the new primitive). A new persisting send is
  rejected if the chat already has a *running* job.
- **The result write is a server-owned completion** of that already-authorized job — it
  finishes what the writer started at submission, so it does **not** re-check the live
  writer lease (see Step 3 gotcha A).
- **Cancel is authorized by the *current* active writer** — including a job a previous,
  now-disconnected writer started (writer handoff): a new writer can stop an abandoned
  generation, then start its own (one-job-per-chat means it must free the slot first).

## Design (SSE + jobId reattach)

1. **One generation `JobRegistry` instance** (separate from the proxy's), created in
   `app.ts` and GC-ticked like the proxy's (`tickGc`, `streamJobs.ts:235`). It also
   maintains a **transient `chatId → jobId` index** — server-memory only (no `db.json`),
   surfaced via the projection (step 7) — for one-job-per-chat + reload-resume.
2. **Submission gate, then create + id first.** On `POST /api/v1/generate/chat`, for a
   `durable` send: **(i)** require the **active writer** (reject otherwise; preview
   exempt); **(ii)** reject if the `chatId → jobId` index already has a *running* job for
   this chat. Then `registry.create(...)`, register `chatId → jobId`, and emit a **first
   frame carrying the `jobId`** (`job_accepted`/`info`) **before assembly**, so a drop
   during assembly is reattachable. Unify the id with the existing `generationId`
   (`generationChat.ts:274`) — one id, not two.
3. **Capture the writer authorization on the job at creation.** Store the client's
   active-writer identity/lease on the `StreamJob` (it needs a new field) so **Step 3
   can persist the result under it after the client is gone**. (Producer side of Step 3
   gotcha A — assign it here while the client is present.)
4. **Run detached.** Extract `streamAssembly`'s body into `runGenerationJob(job, input,
   deps)` that pushes events via `registry.pushEvent` instead of writing to `reply`,
   uses **`job.abortController.signal`** (deadline/explicit-cancel only — never
   `req.raw.on('close')`), and **accumulates the streamed text as job state** (needed
   for Step 3's persistence and for streaming-cancel, gotcha B). Launch with `void
   runGenerationJob(...)` (like `void runStreamJob`, `routes/streamJobs.ts:140`).
5. **Stream to the initial client** by attaching an **SSE-backed `JobClient`** to the
   job (`registry.attach`), flushing the buffer (empty initially), then live events.
6. **Disconnect = detach, not abort.** `req.raw.on('close')` now calls
   `registry.detach(jobId, client)` (`streamJobs.ts:198`). The job keeps running; once
   `clients.size === 0`, `pushEvent` buffers (`:168`).
7. **Reattach + resume-after-reload.** `GET /api/v1/generate/chat/:id/stream` (SSE) →
   auth → `registry.attach` → flush buffered events → live. `404` if the job is unknown
   / GC'd (a *completed* job is read from `db.json` via normal projection). A returning
   client — **even after a full reload** — discovers the job from the projection's
   transient `chatId → jobId` field and reattaches, so resume is **not** deferred.
   **Observe vs. control:** read-only reattach (observe) is open to any authenticated
   client; *starting* and *cancelling* require the active-writer lease.
8. **Completion + grace, in order:** **Step 3 persists the result → get the bumped
   revision → push the terminal frame carrying that revision → `registry.markDone`**
   (`:207`). **Clear the chat's submission lock (the `chatId → jobId` *running* entry)
   at completion/cancel — not at GC** — so the user's next message / auto-continue isn't
   blocked during the 30s reattach grace (the done job stays reattachable but no longer
   blocks a new generation). The 30s `DONE_GRACE` lets a reconnecting client catch the
   tail; GC then drops only the in-memory job + buffer (the result is already in
   `db.json`).

## Key design decisions / gotchas

**A. Preserve the SSE event vocabulary (the reason we chose SSE).** `JobRegistry.pushEvent`
hardcodes `JSON.stringify(event)` (`:167`). Generalize it to accept an **already-
serialized frame string** (or add `pushRaw`) so generation can buffer the existing
`writePromptChatEvent` named-event frames unchanged. The browser's SSE parser and the
typed event contract stay as-is. The proxy keeps the `JSON.stringify` path.

**B. Cancel becomes EXPLICIT, and its persistence matches today's stop behavior.**
Disconnect no longer aborts, so "stop" can't be "close the connection." Add
`DELETE /api/v1/generate/chat/:id` → `registry.deleteJob(id)` (`:226`), authorized by
the **current active writer**. **The browser abort button must call DELETE**;
navigation-away does **not** cancel — the generation runs to completion (decision:
let-it-finish; resource control is the 64-job cap + deadline GC + one-job-per-chat). On
cancel, persist what the user already saw — verified against `streamResponse.ts:107-115`
/ `nonStreamResponse.ts`:
- **non-streaming → discard** (nothing was shown; abort = no done = no write);
- **streaming → persist the accumulated-so-far text** (the streaming row keeps the
  streamed portion today). The job already accumulates this text (step 4); on abort it
  persists it **iff** streaming. Cancel implies a connected client, so "streamed to the
  user" = the job's accumulated text at abort.

**C. Buffer eviction & the server-held result.** `pushEvent` evicts oldest events past
`MAX_PENDING_EVENTS` (512) / `MAX_PENDING_BYTES` (2MB) (`:171-178`), so a long
disconnect could drop early token chunks. Because Step 3 persists the **server-held
accumulated result**, eviction can never corrupt the durable result — it only causes a
transient gap in a *reattached client's live display*, which self-heals when the client
reconciles to the server-persisted message via projection.

**D. Wire Step 1 here.** `resolveDurableGeneration === 'durable'` → the job path.
`'non-durable'` → **today's exact inline flow, unchanged** (keep `attachAbort` for it).
Step 2 must not regress non-durable sends.

**E. Auth on reattach.** The client uses `fetch` + manual SSE parsing (not
`EventSource`), so the reattach `GET` authenticates with the `risu-auth` header like
other routes (no query-param token, unlike the proxy WS).

**F. Persistence is server-owned; suppress the browser persist by durable-ness.** The
browser **never** persists the durable result — suppress its persist call regardless of
first-connect / reattach / completion state, keyed on **durable-ness, not connection
state** (else a reattach could wrongly re-persist). The detached-writer identity is
captured at creation (step 3) and consumed by Step 3.

## What explicitly stays the same

- The SSE event vocabulary and the browser's SSE parser (only a reattach reader added).
- Non-durable sends run exactly as today (inline `attachAbort`, browser-persist).

## Prove (Step 2 half; persistence assertions are in Step 3, landing together)

- **Survive + reattach (EC-D3):** start a durable generation; drop the initial SSE
  connection mid-stream; assert the job keeps running (not aborted); reconnect via the
  reattach `GET`; assert the buffered + remaining events arrive.
- **Resume after full reload:** a fresh client (no in-memory `jobId`) discovers the
  running job from the projection's `chatId → jobId` field and reattaches.
- **Submission gate:** a non-active-writer persisting send is rejected; a second send on
  a chat with a running job is rejected; preview by a non-writer is allowed.
- **Lifecycle half of EC-D1:** with the client gone for the whole generation, assert
  the job reaches `done` server-side.
- **Explicit cancel:** `DELETE /…/:id` (by the current writer) aborts the provider
  dispatch; a bare disconnect does **not**; a new writer can cancel a prior writer's job.
- **Cancel persistence:** streaming cancel persists the accumulated-so-far text;
  non-streaming cancel persists nothing.
- **Lock lifetime:** after completion the chat accepts a new send immediately (lock
  cleared at completion, not after the 30s grace).
- **Non-durable untouched:** a `non-durable` send still uses the inline `attachAbort`
  flow and aborts on disconnect (no regression).

## Scope guard

- **No interim browser-persist** (decision A — Steps 2+3 land together).
- **One job per chat** (no exception, even for the active writer); the chat's submission
  lock is the `chatId → jobId` *running* entry, cleared at completion/cancel.
- **No transport rewrite** — SSE stays; no WebSocket.
- `send` mode only.
- Do not touch the `resolveServerPromptAssembly` arms or slice-4 post-gen work.

## Deferred / follow-ups (record, don't silently drop)

- `continue` / `regenerate` modes.
- Server-restart durability (Milestone 2 — disk-persisted jobs).

(Full-reload reattach is **no longer deferred** — resolved by the transient
`chatId → jobId` index surfaced via the projection: design steps 1–2 + 7.)

## When this step is done (with Step 3)

- [ ] A durable-subset generation runs as a detached `JobRegistry` job; the request
      connection is a detachable viewer, not the lifecycle owner; the job carries the
      captured writer identity and accumulates the streamed text.
- [ ] Submission gate: non-active-writer persisting sends rejected (preview exempt);
      one *running* job per chat via the transient `chatId → jobId` index; the lock
      clears at completion/cancel.
- [ ] `req.raw.on('close')` detaches (does not abort) for the durable path; the
      non-durable path is unchanged.
- [ ] `GET /…/:id/stream` reattaches and flushes missed events (incl. after a full
      reload, via the projection); `DELETE /…/:id` cancels (current-writer-authorized);
      the browser abort button calls DELETE; cancel persistence follows the
      streaming/non-streaming rule.
- [ ] The SSE event vocabulary + client parser are unchanged (only a reattach reader
      added).
- [ ] `resolveDurableGeneration` is wired: durable → job path, non-durable → today's
      flow; the browser's durable persist is suppressed by durable-ness.
- [ ] Step 2 tests above green (Step 3 carries the persistence tests).
