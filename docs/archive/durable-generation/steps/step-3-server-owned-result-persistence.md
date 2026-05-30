# Step 3 (Milestone 1): server-owned result persistence

Date: 2026-05-29
Status: **DRAFT spec** — durable-generation workstream (`../README.md`), Milestone 1
(disconnect-only). Closes the milestone. **Lands together with Step 2** (decision A —
no interim browser-persist).
**Revised 2026-05-30 (decision #2):** the durable subset now INCLUDES the A2 post-gen
path, so this step runs `runServerPostGeneration` at completion and persists the
*derived* result. It now depends on slice 4 (landed) — it is no longer the
"sidesteps A2" case.

| | |
| --- | --- |
| **Workstream / milestone / step** | Durable generation · Milestone 1 · Step 3 |
| **Depends on** | **Step 2** (the surviving job + terminal frame + captured writer identity); **C-A1** (the route persistence machinery, landed `654db21a`); **slice 4 / A2** (`runServerPostGeneration`, landed `fb279717`) |
| **Reuses** | `persistAssemblyMutations` / `applyJsonCommandMutation` (`generationChat.ts`, `commands/mutations.ts`); `reconcileServerCommandRevision` (browser) |
| **Replaces** | the browser's `persistServerBackedGenerationResult` (`serverBackedSendChat.ts`, called from `index.svelte.ts`) for the durable path |
| **Goal** | When a durable-subset generation job completes, **the server writes the assistant message to `db.json` itself** (via the C-A1 command machinery), so the result is durable even if the client never returns. Closes EC-D1 (persistence half), EC-D2, EC-D4. |

## Result persistence runs the A2 post-gen pass (decision #2)

The durable subset now **includes** the A2 post-gen path (decision #2 — slice 4
landed), so the result the server persists is the **derived** result, not the raw
provider text. At job completion the durable job runs `runServerPostGeneration` — the
same pass A2/slice 4 added, today invoked by `buildPostGenerationFrame` on the
connected `/generate/chat` path: run-var pass, `'output'` trigger, `editoutput`. It
then persists, server-side:

- the assistant message with the **post-gen final text** (after `editoutput`), and
- the **post-gen scriptstate delta** (run-var + output-trigger writes),

via the same C-A1 `applyJsonCommandMutation` machinery the assembly-time write uses.
There is **no split-brain**: on the durable path the browser does not also derive
post-gen (it may be disconnected) — the server owns the whole derivation.

Scope this narrowly: this is "the server persists the **derived** result for the
durable subset." The general (non-durable) path is unchanged — it keeps today's
connected `/generate/chat` A2 behavior (server post-gen frame + browser result
persist).

## What moves

| Concern | Today (durable path, after Step 2) | Step 3 |
| --- | --- | --- |
| Assembly-time scriptstate | server persists during the request (C-A1) | unchanged |
| **Post-gen derivation (output trigger / `editoutput` / run-var)** | server already runs it on the connected `/chat` path (A2/slice 4) | **server**, in the job at completion — before the result write |
| **Assistant message (result)** | **browser** `persistServerBackedGenerationResult` after the stream | **server**, at job completion (the post-gen-**derived** text) |
| **Post-gen scriptstate delta** | server post-gen frame → browser reconciles | **server** persists it in the job (no browser frame needed on the durable path) |
| TTS / emotion / notification / image-gen / stage timing | browser (B1/B2) | unchanged — stays browser |
| auto-continue / resend recursion | browser (B2 control flow) | unchanged — stays browser (driven on reattach) |

Only the **durable write of the result** moves. The browser keeps rendering streamed
tokens live and keeps all B1/B2 effects.

**Two server writes per durable send:** C-A1 persists the assembly-time scriptstate
*during the request* (revision bump #1 — persists even if the client drops before
completion); this step persists the result *at completion* (bump #2). Two bumps, two
reconciliations on the browser side.

## Design

1. **Run the A2 post-gen pass, then persist — in the job.** In Step 2's
   `runGenerationJob`, after the provider produces the raw final text, run
   `runServerPostGeneration` (reuse the slice-4 pass) to get the **derived** final
   text + post-gen scriptstate delta. Then construct the assistant message (role
   `char`, the **derived** final text, `generationInfo`, message id) and persist it —
   plus the post-gen scriptstate delta — with a sibling of `persistAssemblyMutations`,
   the same `applyJsonCommandMutation` path: one revision bump, one event, rollback on
   failure. Match the exact persisted shape `dispatchPersistGenerationResult`
   (`chatCommands.ts:473`) writes today, so the result is byte-identical whether
   server- or (legacy) browser-written.
2. **Carry the revision on the terminal frame.** Like C-A1's `info` frame, the
   terminal/done frame returns the bumped revision.
3. **Browser stops persisting; reconciles.** For the durable path, delete the
   `persistServerBackedGenerationResult` call for the durable path; instead
   `reconcileServerCommandRevision` to the revision on the terminal frame (same move
   C-A1 made for the scriptstate delta). The browser still renders the streamed text
   live; the durable write is the server's. **EC-D4: zero browser persist POSTs.**

## Key design decisions / gotchas

**A. Deferred-writer identity — DECIDED: server-owned completion of an authorized write.**
C-A1's assembly-time write is synchronous *during* the request (`generationChat.ts:381`),
so the client's authorization is present. The **result** write happens at completion —
possibly **after the client disconnected**. Resolution: authorization happens at
**submission** (Step 2's gate requires the active writer to start a persisting send);
the completion write is the server **finishing that already-authorized job**, taking a
**narrow, audited bypass** of the live active-writer check (it is *not* a new client
write). Conflict-prevention is preserved by the submission gate + **one-job-per-chat**
(Step 2), and the write still composes with any intervening edits via gotcha C ("read
the current chat at completion"). Step 2 captures the authorization on the job at
creation; Step 3 persists under it. The submission gate already exists globally in
`server/fastify/src/activeWriter.ts`: `isServerOwnedMutation` includes
`POST /api/v1/generate/chat`, and the browser carries `risu-writer-session` on the
`/chat` request. Step 2 should reuse that guard and capture the accepted writer
identity before detaching the job.

**B. Idempotency on `generationId`.** With Step 2 reattach, a client may also still be
connected at completion. The server persist must be **idempotent**: keyed by
`generationId` / message id (`ensureMessageId` / `targetMessageId` already exist), so a
duplicate from reattach or a legacy browser path is a no-op/update, never a second
appended message.

**C. Revision composition + chat-changed edge.** Read the **current** chat at
completion and append (don't write from a creation-time snapshot), so the result
composes with any intervening writes; `applyJsonCommandMutation`'s revision discipline
applies. If the target chat is gone or materially changed since creation (e.g. user
deleted messages / switched chats), the mutation fails — record a job **error** the
reattaching client can see; do not force-write.

**D. EC-D2 needs no new read endpoint.** Once the server persists the message + bumps
revision + emits the event, a returning client sees the completed chat through the
**existing** projection refresh (event-driven debounce, or a fresh bootstrap on
reload). The Step 2 reattach SSE handles the *still-running* case; normal projection
handles the *completed* case. So "check the completed chat later" falls out of the
existing machinery.

**E. Three terminal cases for the persist path.** Completion → run the A2 post-gen
pass over the full text, then persist the **derived** result. **Streaming** cancel →
persist the accumulated-so-far text **raw** (do not run output-trigger / `editoutput`
over a truncated turn — Step 2 gotcha B). **Non-streaming** cancel → no write. All are
idempotent on `generationId` (gotcha B).

**F. Post-gen failure policy on the durable path — RESOLVED (implemented).** Closeout
decision #2 keeps the connected `/chat` post-gen pass *best-effort* (a throw is
swallowed; the browser keeps its streamed copy). On the durable path the client may be
gone, so "browser keeps its copy" is not a safe fallback. Decided and shipped in
`buildDurablePostGeneration` (`server/fastify/src/routes/generationChat.ts`): a
**derivation** throw (`runServerPostGeneration`) → persist the **raw** provider text +
emit a `warning` (so a disconnected turn is never silently lost); a **persist** throw
(gotcha C — chat deleted / materially changed) → emit an `error` the reattaching client
sees, and do not force-write.

## EC closure

With Steps 2 + 3: the generation **survives** disconnect (Step 2) **and the result
persists with no client present** (Step 3). **EC-D1 fully closed.** EC-D2 via normal
projection. EC-D4 via the browser dropping its persist POST. EC-D3 was Step 2.
**Milestone 1 complete.**

## Prove

- **True EC-D1:** start a durable generation, drop the client for the **entire**
  duration (never reconnect); assert the assistant message lands in `db.json`, the
  revision bumped once, one event emitted.
- **A2 derivation on the durable path (decision #2):** a durable send with an
  `'output'` trigger + `editoutput` persists the **post-gen-derived** text and the
  post-gen scriptstate delta server-side, with no browser involvement.
- **EC-D2:** a fresh client projection (bootstrap) after completion shows the message.
- **EC-D4:** zero outbound `dispatchPersistGenerationResult` POSTs for the durable path
  (mirror C-A1's "zero `…/scriptstate` POSTs" assertion in
  `sendChat.fixtures.serverBacked.test.ts`).
- **Deferred writer:** a job whose client disconnected persists under the
  creation-time identity (not a live-writer check at completion).
- **Idempotency:** reattach-at-completion + server persist yields exactly one assistant
  message.
- **Chat-changed edge:** target chat deleted mid-generation → graceful job error, no
  bad write.
- **Non-durable untouched:** non-durable sends still browser-persist (no regression).

## Scope guard

- **Durable subset only.** The durable job runs the A2 pass and persists the derived
  result; the general (non-durable) path keeps today's connected A2 behavior
  unchanged. **Reuse** slice 4's `runServerPostGeneration` — do not fork it.
- Do not move B1/B2 effects (TTS/emotion/notification/image-gen/stage timing/auto-
  continue) server-side.
- Do not build milestone-2 restart durability (the job + result are still in-memory +
  `db.json`; surviving a server *restart* mid-flight is milestone 2).
- `send` mode only.

## When this step is done

- [ ] On durable-job completion the server runs `runServerPostGeneration` (slice 4),
      then writes the **derived** assistant message + post-gen scriptstate delta via
      the C-A1 `applyJsonCommandMutation` path (one revision bump, one event,
      rollback), in the same shape `dispatchPersistGenerationResult` produces.
- [ ] The result write uses the writer authorization captured at job creation and
      works after the client has disconnected; idempotent on `generationId`.
- [ ] The browser durable path drops `persistServerBackedGenerationResult` and
      reconciles the terminal-frame revision; non-durable path unchanged.
- [ ] EC-D1/D2/D4 tests green; EC-D3 (Step 2) still green → **Milestone 1 closed.**
