# Report C — Streaming & displayed-text semantics (CLAUDE track)

Scope: delta `f2dc174f4..HEAD` (177 commits), surface = what the user sees
during and after generation. Baseline: worktree
`/home/codex/risu-baseline-71c476e9c` (fork point `71c476e9c`). Method:
static trace of the four delta entry points plus the stream consumer /
SSE-consumer / terminal-reconciliation call chain, with server-side test
fixtures used as behavioral evidence. No live-browser repro was run.

Adjudication hygiene: CA-OR-3 (single-pass `editoutput` at finalization,
raw-text display mid-stream, cancel persists raw text), CA-OR-4 (post-token
failure restores pre-generation transcript), CA-OR-7/CA-OR-8 (continue row
identity / pass-count, resolved by `8bf88e43c`), and CA-OR-6 (policy
buffering) are NOT re-reported. Findings below are deltas layered on top of
those adjudications or new seams introduced inside this delta.

---

## C-1 — Append-mode Continue streams without the say-nothing base text; the base pops in at terminal

**Severity:** medium. **Classification:** `decide`. **Confidence:** high
(static, corroborated by server fixture assertions).

**Current behavior.** `8bf88e43c` derives the Continue disposition from
`useSayNothing` (`server/fastify/src/prompt/assemble.ts:755-758`); in
`append` mode the server pushes a *transient* `*says nothing*` user boundary
into its working copy only (`assemble.ts:759-772`) and the client streams
into a **new, empty assistant row** with `prefix = ''`
(`src/ts/process/postGeneration/streamResponse.ts:131-139` — the
`extendsContinue` gate is false for `append`, so the push-new-row branch at
`streamResponse.ts:140-170` runs). Mid-stream display is therefore
`reformatContent('' + completionSoFar)`
(`streamResponse.ts:247-255`). Only at the terminal does
`runServerPostGeneration` compute
`finalText = editoutput('*says nothing*' + completion)`
(`assemble.ts:3087-3095`, `:3117-3120`), which
`applyServerBackedTerminal` then writes over the row
(`src/ts/process/serverBackedSendChat.ts:861-863`). The disposition rides
the `info` frame to the stream request
(`src/ts/process/request/serverChat.ts:860`,
`server/fastify/src/routes/generationChat.ts:4580-4582`). Server evidence
that the base is part of the final text pipeline:
`server/fastify/__tests__/generation.chat.test.ts:6402-6473` (append-mode
fixture feeds `'*says nothing*' + completion` through the cutedog
`editoutput` rule).

**Baseline behavior.** At the fork point with `useSayNothing` on (the
default — `/home/codex/risu-baseline-71c476e9c/src/ts/storage/database.svelte.ts:195-197`),
pressing Continue first pushed a **visible** `*says nothing*` user row
(`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:170-182`),
and the streaming loop then targeted that last row with
`prefix = '*says nothing*'`
(`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1533-1538`),
so every displayed frame was
`editoutput(reformat('*says nothing*' + partial))`
(`index.svelte.ts:1582-1585`) — the base text was on screen from the first
token.

**User-visible consequence + repro.** Default settings (`useSayNothing`
on), streaming on, press Continue after an assistant reply. Fork point: the
bubble reads `*says nothing* Once upon…` and grows monotonically. Current:
a new assistant bubble grows with the completion only (`Once upon…`), and at
completion the text visibly jumps as the `*says nothing*` base (and any
`editoutput` transform over it) is prepended. For script-less cards the
literal base pops in at the front of the bubble on every default-config
Continue. The mid-stream absence of `editoutput` is CA-OR-3 and not
re-reported; the missing *base text* is a separate, unadjudicated layer
introduced by the append-mode client seam of `8bf88e43c`.

**Notes for the maintainer.** (a) The persisted end state (assistant row
containing `editoutput('*says nothing*' + completion)`, boundary transient)
matches the fork point's *buffered* Continue and is the adjudicated
CA-OR-7/CA-OR-8 design — this finding is only about the mid-stream display
evolution. A client-side fix is cheap: seed `prefix = '*says nothing*'` in
`consumeStreamResponse` when `req.continueDisposition === 'append'`.
(b) Sub-case not covered by any adjudication I could find: at the fork
point, Continue with the *last row being a user message* streamed into the
user's own bubble (no say-nothing row was pushed because the last role was
already `user`, `DefaultChatScreen.svelte:172`); current append mode still
creates a fresh assistant row with the say-nothing base. Current behavior
is saner, but under the charter it needs a sign-off rather than silence.

---

## C-2 — Half-streaming Stop makes the partial vanish from display while the server persists it

**Severity:** medium-low. **Classification:** `decide`. **Confidence:**
medium-high (static; hydration-latency half not traced end-to-end).

**Current behavior.** In half-streaming mode the SSE consumer never
enqueues token text — it only records throughput
(`src/ts/process/request/serverChat.ts:1079-1088`), so
`consumeStreamResponse`'s `result` stays `''` for a managed half-stream.
On Stop, the abort path reaches `removeEmptyGeneratedMessage`
(`src/ts/process/postGeneration/streamResponse.ts:266-275`, invoked at
`:338`): `result.length > 0` is false, the appended row's `data` is `''`,
and the placeholder assistant bubble is **spliced out of the transcript**.
Meanwhile the server persists the accumulated raw partial as a real
assistant row and bumps the revision
(`server/fastify/src/routes/generationChat.ts:4711-4737`
`persistRawCancelledResult`, cancelled `done` frame at `:4835-4851`).
The canceller never applies that terminal: the orchestrator returns
`aborted` before the terminal is awaited
(`src/ts/process/postGeneration/orchestrateResponse.ts:131-133`,
`src/ts/process/index.svelte.ts:554-556`), and even on the operation-stream
path (where the viewer stays attached,
`serverChat.ts:702-705`) the read loop has already exited, so the enqueued
cancelled snapshot is never rendered.

**Baseline behavior.** No half-streaming exists at the fork point; the
nearest analog (streaming abort) *kept* the accumulated partial visible and
in the transcript
(`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1592-1601`
— the row written per-chunk survives the `return false`).

**User-visible consequence + repro.** Enable half-streaming
(`halfStreaming` global or profile runtime option), durable send, let the
token counter run, press Stop. The "generating" bubble disappears entirely,
telling the user the cancel discarded everything — but the server persisted
the partial row, which reappears on the next hydration (chat re-entry,
reload, revision-conflict refresh, or cancellation-reconcile refresh).
Displayed and persisted text disagree for the window in between, and the
reappearance reads as a ghost message. Secondary seam: on the *local*
provider path (non-server-routable providers), half-streaming Stop removes
the row and nothing is persisted at all, so the partial is silently lost —
the opposite of the durable outcome.

**Note.** Non-half-streaming cancel is clean: the client keeps the
streamed partial, the server persists the equivalent raw partial (CA-OR-3
covers raw-vs-processed), and the two converge. The defect is specific to
the buffer-until-done mode interacting with the empty-row cleanup clause
added in `ba5bd8be5` (`streamResponse.ts:269`).

---

## C-3 — After a replay-budget gap, incremental display freezes until the terminal; the gap is never surfaced to the user

**Severity:** low. **Classification:** `candidate-keep`. **Confidence:**
high.

**Current behavior.** When a reattach replays a job whose retained window
was evicted, the server sends a `replay_gap` frame first
(`server/fastify/src/streamJobs.ts:676-686`; eviction bookkeeping
`:522-541`). The client zeroes its accumulator and suppresses every
subsequent token enqueue until the terminal
(`src/ts/process/request/serverChat.ts:1004-1010`, `:1086-1088`), then
renders the canonical `done.result` snapshot
(`:1151-1168`, per `f372c0ee6`). The `gapTruncated` marker is exposed on
the stream projection (`src/ts/process/postGeneration/streamResponse.ts:70`,
`:360`) but nothing consumes it — no toast, no placeholder text.

**Baseline behavior.** No replay exists at the fork point; the comparison
mandated by the brief is the *uninterrupted* fork-point session, which
showed continuous incremental growth for the whole generation
(`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1560-1590`).

**User-visible consequence + repro.** Reattach (reload / second device) to
a generation long enough to overflow 512 events / 2 MiB per job (or evicted
by the 16 MiB aggregate while other jobs stream): the bubble sits frozen at
stale-or-empty content with no incremental updates and no explanation until
the generation completes, then snaps to the full final text. Final
displayed text is correct (verified: durable `done` frames always retain
`result`; only the negotiated inline path omits it —
`server/fastify/src/routes/generationChat.ts:2565-2568` vs `:4641`), so
this is a liveness/feedback divergence, not a text-integrity one. Keeping
it is reasonable (bounded memory, correct convergence); surfacing the
already-typed gap signal in the UI would be a cheap improvement.

---

## C-4 — Mid-session reconnect replays can transiently regress the visible bubble text

**Severity:** low. **Classification:** `candidate-keep`. **Confidence:**
medium (visibility depends on a paint landing mid-replay-burst).

**Current behavior.** On a transport drop, the durable reconnect path
resets `tokenResult = ''` and rebuilds from the replayed retained window
(`src/ts/process/request/serverChat.ts:929-935`). Each replayed cumulative
snapshot is enqueued; `consumeStreamResponse` applies the newest payload
per animation frame (`streamResponse.ts:242-265`,
`src/ts/process/postGeneration/streamCoalescer.ts:56-78`). If a frame is
painted while the rebuild is mid-window, the bubble visibly shrinks to a
shorter prefix and regrows. An uninterrupted fork-point session was
strictly monotonic. Replay frames arrive in one buffered burst and the
coalescer batches to the newest payload, so in practice this is at most a
single-frame flicker; no dropped or duplicated spans result (token
compaction preserves order and concatenated content —
`server/fastify/src/streamJobs.ts:439-464`).

---

## Areas swept and found clean

- **Half-streaming off leaves fork-relative behavior untouched.** With
  `halfStreaming` false (default,
  `server/fastify/src/databaseDefaults.ts`), the `ba5bd8be5` edits are
  no-ops: `targ.useStreaming` reduces to the pre-commit expression
  (`src/ts/process/request/request.ts:904-909`), `withHalfStreamingMode`
  passes streaming responses through unchanged (`request.ts:123-131`),
  every `consumeStreamResponse` half-streaming branch is gated on
  `req.halfStreaming === true` (`streamResponse.ts:115-123`, `:301-313`,
  `:325-327`, `:343`), and the server stream condition
  (`server/fastify/src/prompt/chatDispatch.ts:1224-1231`) reduces to
  `db.useStreaming === true`. Escape-output and banned/blank policy
  fallbacks force `halfStreaming: false` together with
  `useStreaming: false` (`server/fastify/src/routes/generationChat.ts:265-272`,
  `:399-404`), preserving the fork's forced-buffered cases. Half-streaming
  is absent from the baseline and from `docs/upstream-sync/` — it is an
  original opt-in feature, not an upstream port, so its enabled-state
  display (buffer until done + tokens/sec indicator,
  `src/lib/ChatScreens/Chat.svelte:1487-1490`, `:2244-2249`) has no
  fork-parity obligation.
- **Extend-mode Continue stream display matches the fork point.** Same
  bubble (`streamResponse.ts:131-139` mirrors baseline
  `index.svelte.ts:1535-1538`), `prefix + completion` growth, completion-
  only `trimUntilPunctuation` during streaming (`streamResponse.ts:310-312`
  = baseline `:1579-1581`), and the terminal rewrites the same row in place
  preserving its id (`server/fastify/src/routes/generationChat.ts:1719-1722`,
  `server/fastify/src/prompt/assemble.ts:2729-2732`). Only the
  adjudicated CA-OR-3 `editoutput` timing differs mid-stream.
- **No prefix duplication or span loss through replay/terminal
  canonicalization.** Durable `done.result` is the raw completion only
  (accumulated in `server/fastify/src/prompt/providerTransport.ts:150-152`,
  emitted at `:129-137`), so `tokenResult = done.result` +
  client-side `prefix +` concatenation cannot double the extended text;
  token batch-compaction concatenates in order
  (`streamJobs.ts:439-464`); attach replays the full retained window before
  live frames (`streamJobs.ts:670-711`).
- **Inline (non-durable) streams keep the negotiated fallback-only
  contract** (`serverChat.ts:1161-1165`): displayed final text = accumulated
  tokens, `done.result` used only when no token text arrived — fork-parity
  for the visible outcome.
- **Cancelled terminals skip TTS, translation, reroll seeding, completion
  sound, IGP** (`serverChat.ts:1170-1179`,
  `src/ts/process/index.svelte.ts:582-587`,
  `orchestrateResponse.ts:135-137`) — matching the fork's abort
  short-circuit before those side effects
  (baseline `index.svelte.ts:1599-1624`).
- **A reattached observer of a cancelled job displays the partial** (replay
  tokens + cancelled `done.result` applied, row retained because the viewer
  is not aborted) and converges with the persisted mode-aware partial row —
  consistent with fork abort retention (text processing differences are
  CA-OR-3).
- **Terminal-snapshot side-channel** (`serverChat.ts:484-511`,
  `:1138-1149`; `streamJobs.ts:362-383`, `:647-655`): merge order keeps the
  snapshot's `result`/`postGeneration` authoritative; a fetch failure
  surfaces as a terminal failure rather than silently rendering a truncated
  suffix.
- **`4ed196b1f` (stored user translations in bot-only mode)**:
  `autoTranslateBotOnly` does not exist at the fork point (no baseline
  hits), so this is a post-fork feature surface with no parity obligation;
  the change only widens display of already-persisted translations.
- **Wire shape**: `replay_gap`, `done.outcome`, `token.generatedTokens` /
  `elapsedMs`, `info.halfStreaming`, `info.continueDisposition` are all
  additive (`src/ts/process/request/serverChatEvents.ts:63-99`, `:337-376`)
  — consistent with the locked-contract rule.

## Not verified / adjacent observations (explicitly out of this brief's delta)

- **No live-browser verification** was performed; all findings are static
  traces plus server test fixtures. C-1 and C-2 have deterministic code
  paths (high confidence); C-4's perceptibility is timing-dependent.
- **C-2's reappearance latency**: cancellation-reconcile and hydration
  machinery (`src/ts/server/generationOperations.ts:1024-1061`,
  `src/ts/server/chatMessageHydration.svelte.ts`) will eventually surface
  the persisted partial, but I did not trace exactly which trigger fires
  first after a Stop, so "how long the ghost window lasts" is unmeasured.
- Pre-delta divergences noticed in passing, NOT findings of this report
  (origin commits predate `f2dc174f4`; flagged only so Stage 4 can route
  them if desired): (a) pre-token abort no longer leaves the fork point's
  empty assistant bubble (`761639c8f`, 2026-06-16); (b) streaming extend
  Continue's *final* text applies `trimUntilPunctuation` over the combined
  prefix+completion (server post-gen, matching fork *buffered*) where the
  fork *streaming* path trimmed the completion only — visible only with
  `removeIncompleteResponse` on and a punctuation-free completion; (c) TTS
  speaks post-`editoutput` text where the fork streaming path spoke the raw
  accumulated result (`f0b1270e5`, 2026-05-24).
