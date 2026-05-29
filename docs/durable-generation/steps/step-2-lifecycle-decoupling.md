# Step 2 (Milestone 1): decouple the generation lifecycle (SSE + jobId reattach)

Date: 2026-05-29
Status: **DRAFT spec** — durable-generation workstream (`../README.md`), Milestone 1
(disconnect-only). Transport decision: **SSE + jobId reattach** (reuse `JobRegistry`).

| | |
| --- | --- |
| **Workstream / milestone / step** | Durable generation · Milestone 1 · Step 2 |
| **Depends on** | **Step 1** (`resolveDurableGeneration`, spec'd) — wired here for the first time |
| **Reuses** | `server/fastify/src/streamJobs.ts` (`JobRegistry`); `routes/streamJobs.ts` (create/run/attach/DELETE pattern) |
| **Touches** | `server/fastify/src/routes/generationChat.ts`, `app.ts` (registry wiring), the browser SSE consumer (`request/serverChat*.ts`) |
| **Goal** | Run a durable-subset generation as a `JobRegistry` job whose lifecycle is **not** tied to the request connection, streamed over SSE, with a `jobId` reattach endpoint. Survive disconnect + reattach. **Persistence stays browser-driven** (Step 3 makes it server-owned). |

## EC mapping (corrected from the README)

- **Step 2 delivers:** EC-D3 (reattach to an in-flight generation, receive the
  remaining events) **and the lifecycle half of EC-D1** (the generation runs to
  completion server-side despite disconnect). The result still lands in `db.json`
  only **if the client reconnects** in the grace window (browser persists via the
  C-A1 path).
- **Step 3 delivers:** the persistence half of EC-D1 (result persisted with **no**
  reconnect), plus EC-D2 / EC-D4.

## The core inversion

Today (`generationChat.ts`): one `POST` opens an SSE stream, `attachAbort` (`:137`)
wires `req.raw.on('close', () => controller.abort())`, and the whole assemble →
dispatch → chunk → done flow runs inline on `reply` (`streamAssembly`, `:240`).
**Disconnect = abort = everything lost.**

Step 2: the generation becomes a detached `JobRegistry` job. The request connection
is just *a viewer* of the job's event stream — dropping it detaches the viewer; the
job keeps running and buffers. Mirror `routes/streamJobs.ts`'s
create → `void run…` → attach shape.

## Design (SSE + jobId reattach)

1. **One generation `JobRegistry` instance** (separate from the proxy's), created in
   `app.ts` and GC-ticked the same way the proxy registry is (`tickGc`,
   `streamJobs.ts:235`).
2. **Create + id first.** On `POST /api/v1/generate/chat`, if
   `resolveDurableGeneration(input) === 'durable'`: `registry.create(...)`, then emit
   a **first frame carrying the `jobId`** (a `job_accepted`/`info` frame) **before
   assembly**, so a drop during assembly is still reattachable. Unify this id with
   the existing `generationId` (`generationChat.ts:274`) — one id, not two.
3. **Run detached.** Extract `streamAssembly`'s body into `runGenerationJob(job,
   input, deps)` that pushes events via `registry.pushEvent` instead of writing to
   `reply`, and uses **`job.abortController.signal`** (deadline/explicit-cancel only)
   — never `req.raw.on('close')`. Launch with `void runGenerationJob(...)` (like
   `void runStreamJob`, `routes/streamJobs.ts:140`).
4. **Stream to the initial client** by attaching an **SSE-backed `JobClient`** to the
   job (`registry.attach`), flushing the buffer (empty initially), then live events.
5. **Disconnect = detach, not abort.** `req.raw.on('close')` now calls
   `registry.detach(jobId, client)` (`streamJobs.ts:198`). The job keeps running;
   once `clients.size === 0`, `pushEvent` buffers (`:168`).
6. **Reattach.** `GET /api/v1/generate/chat/:id/stream` (SSE) → auth → `registry.attach`
   → flush buffered events the client missed → live. `404` if the job is unknown or
   GC'd.
7. **Completion + grace.** On done, push the terminal frame + `registry.markDone`
   (`:207`) — the 30s `DONE_GRACE` lets a reconnecting client catch the tail. GC
   cleans up after grace with no clients.

## Key design decisions / gotchas

**A. Preserve the SSE event vocabulary (the reason we chose SSE).** `JobRegistry.pushEvent`
currently hardcodes `JSON.stringify(event)` (`:167`). Generalize it to accept an
**already-serialized frame string** (or add `pushRaw`) so generation can buffer the
existing `writePromptChatEvent` named-event frames (`event: prompt\ndata: …`)
unchanged. The browser's SSE parser and the typed event contract
(prompt/message_patch/info/chunk/done/error) stay as-is. The proxy keeps using the
`JSON.stringify` path.

**B. Cancel becomes EXPLICIT (important behavior change).** Disconnect no longer
aborts, so a user "stop" can no longer be "close the connection." Add
`DELETE /api/v1/generate/chat/:id` → `registry.deleteJob(id)` (`:226`, aborts the
job's controller). **The browser abort button must call DELETE**, and navigation-away
must not silently leave jobs running — decide the policy (explicit stop vs let it
finish). Without this, every tab close leaks a running generation.

**C. Faithful reconstruction vs buffer eviction.** `pushEvent` evicts oldest events
when over `MAX_PENDING_EVENTS` (512) / `MAX_PENDING_BYTES` (2MB) (`:171-178`). A long
disconnect could drop early **token chunks**, so a reconnecting browser that rebuilds
text from chunks would get a gap. Mitigation for Step 2: **the terminal/done frame
must carry the full accumulated text** (not just incremental chunks), so
reconnect-to-finish persists the complete result regardless of evicted chunks. (Step 3
makes this fully moot — the server holds the result.)

**D. Wire Step 1 here.** `resolveDurableGeneration === 'durable'` → the job path
above. `'non-durable'` → **today's exact inline flow, unchanged** (keep `attachAbort`
for it). Step 2 must not regress non-durable sends.

**E. Auth on reattach.** The client uses `fetch` + manual SSE parsing (not
`EventSource`), so the reattach `GET` authenticates with the `risu-auth` header like
other routes (no query-param token needed, unlike the proxy WS).

**F. Persistence + active-writer stay as today.** The browser still persists the
result on (re)connect via the C-A1 path; it re-presents its writer identity on
reconnect. Server-owned persistence + the detached-writer-identity question are
**Step 3**.

## What explicitly stays the same

- The SSE event vocabulary and the browser's SSE parser (only a reattach reader is
  added).
- Result persistence is still browser-driven (Step 3 moves it server-side).
- Non-durable sends run exactly as today.

## Prove

- **Survive + reattach (EC-D3):** start a durable generation; drop the initial SSE
  connection mid-stream; assert the job keeps running (not aborted); reconnect via the
  reattach `GET`; assert the buffered + remaining events arrive and the browser
  persists the complete result.
- **Lifecycle half of EC-D1:** with the client gone for the whole generation, assert
  the job reaches `done` server-side (even though nothing persists until reconnect).
- **Explicit cancel:** `DELETE /…/:id` aborts the provider dispatch (job controller
  aborts); a bare disconnect does **not**.
- **Terminal carries full text:** force buffer eviction (tiny cap or long stream
  while detached); assert reconnect still reconstructs the complete result from the
  terminal frame.
- **Non-durable untouched:** a `non-durable` send still uses the inline
  `attachAbort` flow and aborts on disconnect (no regression).

## Scope guard

- **No server-owned result persistence** (Step 3). The browser still persists.
- **No full-reload job rediscovery** — Step 2 reattach assumes the same client
  session still holds the `jobId`. Rediscovering an in-flight job after a fresh page
  load is a follow-up (needs a persisted active-generation id or a discovery
  endpoint). Note: a *completed* generation needs no discovery once Step 3 persists it
  — normal projection shows it.
- **No transport rewrite** — SSE stays; no WebSocket.
- `send` mode only.
- Do not touch the `resolveServerPromptAssembly` arms or the slice-4 post-gen work.

## Deferred / follow-ups (record, don't silently drop)

- Full-reload reattach (discover the in-flight job for a chat after a fresh load).
- `continue` / `regenerate` modes.
- Server-restart durability (Milestone 2 — needs disk-persisted jobs).

## When this step is done

- [ ] A durable-subset generation runs as a detached `JobRegistry` job; the request
      connection is a detachable viewer, not the lifecycle owner.
- [ ] `req.raw.on('close')` detaches (does not abort) for the durable path; the
      non-durable path is unchanged.
- [ ] `GET /…/:id/stream` reattaches and flushes missed events; `DELETE /…/:id`
      explicitly cancels; the browser abort button calls DELETE.
- [ ] The SSE event vocabulary + client parser are unchanged (only a reattach reader
      added); the terminal frame carries the full result text.
- [ ] `resolveDurableGeneration` is wired: durable → job path, non-durable → today's
      flow.
- [ ] Tests above are green; persistence is still browser-driven (Step 3 next).
