# Brief C — Streaming & displayed-text semantics (Codex track)

Audit target: current `HEAD` versus Original RisuAI at worktree
`/home/codex/risu-baseline-71c476e9c` (`71c476e9c`), with special attention to
the delta `f2dc174f4..HEAD`. I treated protocol mechanics as evidence only when
they change what a user sees. I did not re-report CA-OR-3, CA-OR-4, or CA-OR-6.

## C-1 — Append-style streaming Continue moves output from the baseline user row to a new assistant row

- **Severity:** medium
- **Current behavior:** `useSayNothing=true` makes a non-group Continue use the
  `append` disposition and creates a transient server-only `*says nothing*`
  boundary (`server/fastify/src/prompt/assemble.ts:754-766`). The streaming
  client does not target that boundary: it takes the non-extend branch and
  creates a new `role: 'char'` row with an empty prefix
  (`src/ts/process/postGeneration/streamResponse.ts:131-169`), then writes only
  `prefix + result` into that row
  (`src/ts/process/postGeneration/streamResponse.ts:242-263`). Successful
  finalization likewise replaces the transient boundary with a new assistant
  row (`server/fastify/src/prompt/assemble.ts:2729-2752`).
- **Baseline behavior:** the Continue button still passes through the empty-input
  path (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:136-143`),
  which appends a real `role: 'user'`, `*says nothing*` row when the option is on
  (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:170-180`).
  The streamed Continue decrements to that last row, captures the sentinel as
  its prefix, does not create an assistant row
  (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1531-1549`),
  and changes only that row's `data`
  (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1572-1585`);
  its user role therefore remains visible after completion.
- **User-visible consequence and repro:** with the default `useSayNothing` on,
  enable ordinary streaming, finish an assistant response, and click Continue.
  Current HEAD immediately streams into a new bot bubble and initially omits
  the sentinel from the live text. The fork point streams
  `*says nothing*<partial>` into a user-styled bubble and leaves that row as the
  generated turn. This is not CA-OR-3: no output script is needed. Extend mode
  (`useSayNothing=false`) is clean and still appends incremental text to the
  existing assistant bubble.
- **Charter classification:** `candidate-keep`. The current speaker attribution
  is substantially saner and is explicitly pinned by the `8bf88e43c` tests, but
  it is a real fork-point UI/transcript divergence and needs individual sign-off
  under the charter.
- **Confidence:** high.

## C-2 — Cancelling append-style Continue leaves displayed and persisted text different

- **Severity:** medium
- **Current behavior:** the live append projection starts with an empty prefix
  and displays only the provider fragment
  (`src/ts/process/postGeneration/streamResponse.ts:131-169`,
  `src/ts/process/postGeneration/streamResponse.ts:242-263`). Cancellation
  persistence, however, explicitly prepends `*says nothing*` before normalizing
  and storing that same fragment
  (`server/fastify/src/routes/generationChat.ts:1767-1801`). The cancelled
  `done` frame carries the unprefixed raw provider result and only persisted
  identity/revision (`server/fastify/src/routes/generationChat.ts:4827-4851`),
  while the browser's cancelled-terminal branch returns without applying a
  message patch or canonical final text
  (`src/ts/process/serverBackedSendChat.ts:780-795`). Thus both the cancelling
  tab and a reattached observer can retain the unprefixed projection even though
  the authoritative row contains the prefix.
- **Baseline behavior:** the actual user sentinel row is already the Continue
  target and supplies the stream prefix
  (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:170-180`,
  `/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1533-1538`).
  Every partial display is derived from `prefix + result`, and abort returns
  while preserving that last displayed row
  (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1572-1600`).
- **User-visible consequence and repro:** set `useSayNothing=true` and streaming
  on; click Continue; let the provider emit ` and then`; click Stop. Current
  local display is `and then` in a bot bubble, while the server persists
  `*says nothing* and then` (the durable regression itself expects that stored
  value at `server/fastify/__tests__/durableGeneration.test.ts:3009-3033`). A
  reload/hydration changes what the user sees. The fork-point row already shows
  the sentinel-prefixed partial before and after Stop. This is a new
  disposition/terminal-reconciliation layer on top of CA-OR-3, not a repeat of
  its single-pass `editoutput` issue; the mismatch occurs with no scripts.
- **Charter classification:** `candidate-fix`. The cancelled terminal should
  reconcile the exact mode-aware persisted raw row, or the live append
  projection should use the same base text.
- **Confidence:** high.

## C-3 — A retried extend-Continue reattach can temporarily duplicate its partial continuation

- **Severity:** medium
- **Current behavior:** a failed reattach is restored and retried without first
  hydrating or rolling back the partial row
  (`src/ts/process/reattach.ts:524-574`). On the next extend-Continue attempt,
  the streaming consumer captures the row's current data—including the partial
  written by the prior attempt—as its new immutable prefix
  (`src/ts/process/postGeneration/streamResponse.ts:124-138`). The SSE consumer
  independently resets its replay accumulator to zero on reconnect
  (`src/ts/process/request/serverChat.ts:925-934`) and rebuilds cumulative replay
  text from retained token deltas (`src/ts/process/request/serverChat.ts:1076-1088`).
  Those replay snapshots are then displayed as `already-partial prefix + replay
  from the beginning`. The successful terminal patch eventually corrects the
  row, but ordinary replay tokens can expose duplication before `done`.
- **Baseline behavior:** an uninterrupted fork-point Continue captures the
  pre-generation row once (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1533-1538`)
  and applies each cumulative result to that one prefix
  (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1572-1585`),
  so the continuation span cannot be counted twice.
- **User-visible consequence and repro:** use extend mode
  (`useSayNothing=false`) and ordinary streaming. Start Continue, reload and
  reattach, allow a partial such as ` wor` to display after existing `Hello`,
  then make transport reconnection exhaust and press Retry (or let the bounded
  retry run) while the durable job remains alive. Replay begins again from the
  continuation start, so the bubble can show a transient value such as
  `Hello wor wor...`; `done.result`/the terminal patch later snaps it back to
  `Hello world`. This is a display-time corruption, not final persistence loss.
- **Charter classification:** `candidate-fix`. A new reattach attempt must base
  extend display on the assembly-time target text (or roll the owned projection
  back) rather than on its prior partial projection.
- **Confidence:** high from the state-machine trace; no focused browser paint
  regression currently covers two consecutive outer reattach attempts.

## C-4 — Hard replay caps can evict the prompt needed to consume the canonical terminal

- **Severity:** low
- **Current behavior:** durable replay is capped at 512 frames / 2 MiB per job
  and 16 MiB aggregate (`server/fastify/src/streamJobs.ts:15-20`). After
  unprotected and nonessential frames are exhausted, the final per-job fallback
  may remove any non-`done` frame, including essential `prompt` or `info`
  (`server/fastify/src/streamJobs.ts:522-540`); reattach then receives only a
  `replay_gap` plus the surviving frames
  (`server/fastify/src/streamJobs.ts:670-700`). This is reachable with one large
  template because the compact generation prompt retains
  `promptInfo.promptText` (`server/fastify/src/routes/generationChat.ts:588-612`),
  and assembly places the rendered prompt rows there
  (`server/fastify/src/prompt/assemble.ts:2486-2497`). The browser refuses to
  expose a streaming request unless both `prompt` and `info` survived
  (`src/ts/process/request/serverChat.ts:845-871`); even a valid canonical
  `done.result` then resolves the reattach as `stream ended without a prompt
  event` (`src/ts/process/request/serverChat.ts:1178-1188`) instead of rendering
  the terminal snapshot.
- **Baseline behavior:** the fork point holds the direct provider request in the
  active call (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1494-1507`)
  and consumes its cumulative stream without a replay metadata gate
  (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1531-1596`).
  The same large prompt in an uninterrupted session can therefore display its
  response.
- **User-visible consequence and repro:** use a custom prompt template whose
  rendered `promptText` makes the protected prompt frame exceed 2 MiB, start a
  durable generation, detach/reload after acceptance, then reattach while it is
  running or terminal-retained. Current emits a gap but cannot construct the
  client stream, reports a failed reattach, and relies on a separate resource
  hydration/reload to reveal the already-persisted result. An uninterrupted
  fork-point session shows the streamed response normally.
- **Charter classification:** `candidate-fix`. Retain a bounded minimal
  prompt/info readiness snapshot, or allow a gap-closing canonical terminal to
  reconcile without the evicted diagnostic prompt payload.
- **Confidence:** high for the code path, medium for practical frequency; no
  focused test exercises one essential frame larger than the byte cap.

## Areas swept and found clean

- **Ordinary, non-half streaming:** with `halfStreaming` false/absent, current
  still enqueues cumulative text and updates the owned row; the new half-mode
  conditions do not suppress ordinary rendering. I found no default-off
  regression from `ba5bd8be5`.
- **Half-streaming itself:** token frames update only throughput, existing
  Continue text stays visible, and one full snapshot is rendered after clean
  closure (`src/ts/process/postGeneration/streamResponse.ts:293-328`). Send,
  regenerate, extend, ordinary completion, empty response, and error cleanup
  did not expose an additional display/persistence mismatch beyond C-2.
- **Normal replay/gap convergence:** 64-frame token compaction concatenates
  deltas in order; after `replay_gap`, suffix tokens are accumulated but hidden;
  durable `done.result` replaces the accumulator and is enqueued before stream
  closure (`src/ts/process/request/serverChat.ts:1076-1088`,
  `src/ts/process/request/serverChat.ts:1136-1169`). Successful send,
  regenerate, append-Continue, and extend-Continue all converge to the
  server-persisted terminal text when readiness frames survive.
- **Extend Continue:** current targets the existing assistant row, uses its
  original text once as prefix, and applies the terminal patch to the same
  identity. Outside C-3's second outer retry, this matches the fork-point live
  display.
- **Successful raw versus derived text:** `done.result` is the complete raw
  provider snapshot, while `postGeneration.finalText`/`messagePatch` replaces
  the displayed row with the server-derived persisted text. I found no final
  display/persistence split on successful terminals.
- **Known exclusions:** streaming `editoutput`/raw cancel behavior (CA-OR-3),
  post-token stream failure restoration (CA-OR-4), and banned/blank policy
  buffering (CA-OR-6) were inspected only for new layering and not re-reported.

## Could not verify

- The available upstream-sync ledger has one completed sweep through upstream
  `f3f0242fb` dated 2026-08-04
  (`docs/upstream-sync/README.md:55-59`,
  `docs/upstream-sync/sweep-2026-08-07.md:119-149`) and contains no
  half-streaming entry. I could not establish a ledger-backed post-fork upstream
  spec for `ba5bd8be5`; I therefore audited its default-off compatibility and
  interactions as a local delta rather than assuming an upstream exemption.
- This was a read-only/static audit. I did not induce a live two-failure
  reattach for C-3, a >2 MiB essential prompt for C-4, or terminal-snapshot
  side-channel I/O failure. The cited branches make C-3/C-4 deterministic, but
  exact browser paint duration and real-world incidence were not measured.
- Six of eight parallel read-only cross-check workers completed; the ordinary
  stream-display and failure/cancel workers timed out. Their scopes were covered
  directly and overlapped the successful replay, disposition, state-machine,
  half-streaming, delta-archaeology, and UI-projection sweeps.

Co-Authored-By: Codex <noreply@openai.com>
