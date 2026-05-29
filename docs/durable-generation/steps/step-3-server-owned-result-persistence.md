# Step 3 (Milestone 1): server-owned result persistence

Date: 2026-05-29
Status: **DRAFT spec** — durable-generation workstream (`../README.md`), Milestone 1
(disconnect-only). Closes the milestone. **Lands together with Step 2** (decision A —
no interim browser-persist).

| | |
| --- | --- |
| **Workstream / milestone / step** | Durable generation · Milestone 1 · Step 3 |
| **Depends on** | **Step 2** (the surviving job + terminal frame + captured writer identity); **C-A1** (the route persistence machinery, landed `654db21a`) |
| **Reuses** | `persistAssemblyChatVars` / `applyJsonCommandMutation` (`generationChat.ts:287`, `commands/mutations.ts:39`); `reconcileServerCommandRevision` (browser) |
| **Replaces** | the browser's `persistServerBackedGenerationResult` (`serverBackedSendChat.ts:339`, called `index.svelte.ts:368`) for the durable path |
| **Goal** | When a durable-subset generation job completes, **the server writes the assistant message to `db.json` itself** (via the C-A1 command machinery), so the result is durable even if the client never returns. Closes EC-D1 (persistence half), EC-D2, EC-D4. |

## Why this is unblocked here (and is NOT the general A2-gated case)

Server-owned result persistence is, in general, **gated on A2** — persisting the raw
result server-side while the browser still derives `editoutput` / output-trigger
mutations would split-brain. **The durable subset sidesteps this by construction:**
Step 1's `resolveDurableGeneration` already excludes output triggers and `editoutput`,
so within the subset there is **no post-gen derivation to conflict with** — the
assistant text the provider produced *is* the final durable text. So Step 3 ships
**without** waiting for slice 4.

Scope this narrowly: this is "the server persists the result **for the durable
subset**," not "the server persists all results" (that remains A2-gated for the
general path).

## What moves

| Concern | Today (durable path, after Step 2) | Step 3 |
| --- | --- | --- |
| Assembly-time scriptstate | server persists during the request (C-A1) | unchanged |
| **Assistant message (result)** | **browser** `persistServerBackedGenerationResult` after the stream | **server**, at job completion |
| TTS / emotion / notification / image-gen / stage timing | browser (B1/B2) | unchanged — stays browser |
| auto-continue / resend recursion | browser (B2 control flow) | unchanged — stays browser |

Only the **durable write of the result** moves. The browser keeps rendering streamed
tokens live and keeps all B1/B2 effects.

**Two server writes per durable send:** C-A1 persists the assembly-time scriptstate
*during the request* (revision bump #1 — persists even if the client drops before
completion); this step persists the result *at completion* (bump #2). Two bumps, two
reconciliations on the browser side.

## Design

1. **Persist at completion, in the job.** In Step 2's `runGenerationJob`, after the
   provider produces the final text, construct the assistant message (role `char`,
   final text, `generationInfo`, message id) and persist it with a sibling of
   `persistAssemblyChatVars` — same `applyJsonCommandMutation` path: one revision
   bump, one event, rollback on failure. Match the exact persisted shape
   `dispatchPersistGenerationResult` (`chatCommands.ts:473`) writes today, so the
   result is byte-identical whether server- or (legacy) browser-written.
2. **Carry the revision on the terminal frame.** Like C-A1's `info` frame, the
   terminal/done frame returns the bumped revision.
3. **Browser stops persisting; reconciles.** For the durable path, delete the
   `persistServerBackedGenerationResult` call (`index.svelte.ts:368`); instead
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
creation; Step 3 persists under it. **Still to locate before implementing:** where
`/chat` enforces the writer/423 gate today (the grep found none in
`generationChat.ts`/`mutations.ts`) — the submission gate hooks in there.

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

**E. Three terminal cases for the persist path.** Completion → persist the full
accumulated text. **Streaming** cancel → persist the accumulated-so-far text (Step 2
gotcha B). **Non-streaming** cancel → no write. All are idempotent on `generationId`
(gotcha B).

## EC closure

With Steps 2 + 3: the generation **survives** disconnect (Step 2) **and the result
persists with no client present** (Step 3). **EC-D1 fully closed.** EC-D2 via normal
projection. EC-D4 via the browser dropping its persist POST. EC-D3 was Step 2.
**Milestone 1 complete.**

## Prove

- **True EC-D1:** start a durable generation, drop the client for the **entire**
  duration (never reconnect); assert the assistant message lands in `db.json`, the
  revision bumped once, one event emitted.
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

- **Durable subset only.** Do not persist results server-side for the general
  (non-durable) path — that stays A2-gated (slice 4). Do not touch slice 4.
- Do not move B1/B2 effects (TTS/emotion/notification/image-gen/stage timing/auto-
  continue) server-side.
- Do not build milestone-2 restart durability (the job + result are still in-memory +
  `db.json`; surviving a server *restart* mid-flight is milestone 2).
- `send` mode only.

## When this step is done

- [ ] On durable-job completion the server writes the assistant message via the C-A1
      `applyJsonCommandMutation` path (one revision bump, one event, rollback), in the
      same shape `dispatchPersistGenerationResult` produces.
- [ ] The result write uses the writer authorization captured at job creation and
      works after the client has disconnected; idempotent on `generationId`.
- [ ] The browser durable path drops `persistServerBackedGenerationResult` and
      reconciles the terminal-frame revision; non-durable path unchanged.
- [ ] EC-D1/D2/D4 tests green; EC-D3 (Step 2) still green → **Milestone 1 closed.**
