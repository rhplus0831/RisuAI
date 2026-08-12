# Brief B — Persisted transcript & mutation semantics (CLAUDE track)

Delta audited: `f2dc174f4..HEAD` (177 commits). Baseline: worktree
`/home/codex/risu-baseline-71c476e9c` (`71c476e9c`). All findings verified by
reading both sides; none executed live (see "Could not verify").

Baseline facts load-bearing for several findings below, established once:

- Fork-point composer send (`src/lib/ChatScreens/DefaultChatScreen.svelte:143-215`
  @baseline): empty input + `useSayNothing` + last row not `user` pushes a
  **durable** `{role:'user', data:'*says nothing*', name:null}` row (no `time`,
  lines 170-181) — for BOTH plain send (`sendMain(false)`) and Continue
  (`sendMain(true)`); non-empty input runs the input trigger, then pushes the
  `editinput`-transformed row (lines 186-196).
- Fork-point `sendChat` streaming continue (`src/ts/process/index.svelte.ts:1531-1548`
  @baseline): `msgIndex -= 1`, `prefix = message[msgIndex].data`, then each chunk
  writes `message[msgIndex].data = editoutput(prefix + partial)` (line 1582-1583).
  **The row's `role` is never changed.** Buffered continue
  (`index.svelte.ts:1626-1672` @baseline) runs `editoutput` twice (raw fragment at
  the prospective index, then combined at `length-1`) and **replaces** the last row
  with a brand-new object `{role:'char', time:Date.now(), chatId:generationId,
  generationInfo, promptInfo}` regardless of `useSayNothing`.
- Rows lacking `chatId` get one durably assigned during assembly
  (`index.svelte.ts:854-855` @baseline mutates the live row).

---

## B-1 — Append-mode *streaming* Continue creates a new assistant row; fork point streamed into the persisted say-nothing **user** row [high]

- **Current:** `server/fastify/src/prompt/assemble.ts:755-772` derives
  `continueDisposition='append'` (`useSayNothing===true`, non-group continue) and
  pushes a **transient** boundary row (never durable). The client treats
  append-mode streaming continue as a fresh append:
  `src/ts/process/postGeneration/streamResponse.ts:131` (`extendsContinue` is
  false when `continueDisposition === 'append'`) → pushes a **new** `char` row
  keyed `chatId=generationId` with fresh `time`/`generationInfo`
  (`streamResponse.ts:152-168`); `src/ts/process/index.svelte.ts:473-479` leaves
  `serverGenerationTargetMessageId` undefined for that mode. The server persists a
  new assistant row built from `'*says nothing*' + completion` through single-pass
  `editoutput` (`assemble.ts:3087-3101`, `:3117-3126`, `appendAssistantRow`
  `assemble.ts:2726-2755`).
- **Baseline:** `DefaultChatScreen.svelte:170-181` @baseline pushed the durable
  sentinel; `index.svelte.ts:1535-1537`, `:1582-1583` @baseline then streamed
  `editoutput('*says nothing*' + partial)` **into that same row, leaving
  `role:'user'`**, with no new row, no fresh `generationInfo`, and per-chunk
  `editoutput`.
- **Consequence / repro:** `useSayNothing` on (the default on both sides —
  `src/ts/storage/database.svelte.ts:2890-2891`,
  `server/fastify/src/databaseDefaults.ts:286`), streaming provider, click
  Continue under an assistant reply. Fork point: transcript ends with a
  **user-role** row `'*says nothing*<continuation>'` carrying the sentinel's row
  identity and no generation metadata; the next empty send then skips the
  sentinel (last row is `user`). Current: transcript ends with a **new
  assistant** row keyed by `generationId` with fresh metadata. Row count, role,
  identity and metadata all differ. (Buffered continue matches the fork point —
  see swept-clean list.)
- **Classification:** `decide` — recommend keep: the baseline outcome (assistant
  continuation persisted as a user-role row) corrupts role semantics for the
  following turns, but it is exactly what the fork point durably wrote, and this
  is the same `useSayNothing` card ecosystem the `8bf88e43c` fix served.
- **Confidence:** high (both sides code-verified; not executed).

## B-2 — Append-mode Continue injects the boundary unconditionally; fork point skipped it when the last row was already a user row [low]

- **Current:** `server/fastify/src/prompt/assemble.ts:755-772` — disposition
  depends only on mode/type/`useSayNothing`; the transient boundary is pushed
  with no check of the current tail row. Also boundary `name:
  database.username` (`assemble.ts:765`).
- **Baseline:** `DefaultChatScreen.svelte:172` @baseline pushed the sentinel only
  when `cha.length === 0 || cha[cha.length-1].role !== 'user'`; sentinel `name`
  was `null` in normal (non-multiuser) use (`:177`). With a trailing user row,
  fork-point Continue extended (streaming) or **replaced** (buffered) that
  trailing user row with `editoutput(userText + continuation)`.
- **Consequence / repro:** transcript ends with a user row (e.g. previous
  generation failed after append), `useSayNothing` on, press Continue. Fork
  point: no sentinel in the prompt; the trailing user row is consumed/replaced by
  the merged assistant row. Current: prompt additionally contains a
  `*says nothing*` user row after the real user row (payload surface), and the
  persisted outcome keeps the user row and appends a separate assistant row
  prefixed `'*says nothing*'`. Sub-note: during assembly, CBS/Lua history reads
  see boundary `name=username` where the fork exposed `null`.
- **Classification:** `decide` — the fork behavior destroys the user's text
  (data-destructive replace), so recommend keep, but both prompt payload and
  persisted rows diverge for this state.
- **Confidence:** medium-high (edge state; code-verified, not executed).

## B-3 — Cancelled/failed append-mode Continue leaves no residue; fork point left the durable `*says nothing*` user row (with any partial text) behind [med]

- **Current:** the boundary exists only inside assembler working state
  (`assemble.ts:759-772`; filtered from every persistence capture via
  `persistentMessageRows`, `assemble.ts:836-840`, `:988-991`, `:1433-1436`). A
  non-streaming cancel persists nothing
  (`server/fastify/src/routes/generationChat.ts:4253-4256`); a durable streaming
  cancel persists the partial as a **new assistant row**
  `'*says nothing*'+partial` via `buildRawModeMessage`
  (`generationChat.ts:1767-1802`, `persistRawCancelledResult`
  `generationChat.ts:4261-4312`). A pre-token failure leaves the transcript
  unchanged.
- **Baseline:** the sentinel was pushed durably **before** generation
  (`DefaultChatScreen.svelte:170-181` @baseline). Buffered continue aborted
  before the response landed → `index.svelte.ts:1524-1526` @baseline returns with
  the sentinel row still in the transcript; streaming abort →
  `index.svelte.ts:1599-1601` @baseline returns with the sentinel row containing
  `editoutput('*says nothing*'+partial)`, still `role:'user'`. Retrying Continue
  then reused that residue row (last row `user` → no second sentinel).
- **Consequence / repro:** `useSayNothing` on, press Continue, hit Stop before
  (or during) the response. Fork point: a `*says nothing*` user row (possibly
  with partial continuation) remains in the transcript and shapes the retry.
  Current: nothing remains (pre-token), or a new assistant row with the raw
  partial remains (durable streaming). The raw-vs-processed partial text aspect
  is already adjudicated (CA-OR-3); the **residue-row role/identity/row-count**
  aspect is new.
- **Classification:** `decide` — recommend keep (the fork residue looks
  accidental), but it is user-visible on every cancelled Continue under the
  default setting.
- **Confidence:** high.

## B-4 — Evidence: CA-OR-7 "resolved" is only partial — extend-mode buffered Continue still keeps old row identity/metadata [med]

- **Current:** with `useSayNothing` **off** (`continueDisposition='extend'`),
  buffered Continue rewrites the last assistant row in place preserving its
  original `chatId`, `time`, `generationInfo`, `promptInfo`
  (`server/fastify/src/prompt/assemble.ts:2728-2732` — `{...messages[continueIndex],
  data: editedText}`; persisted as a clone of that same row,
  `server/fastify/src/routes/generationChat.ts:1719-1722`).
- **Baseline:** `index.svelte.ts:1648-1662` @baseline replaced the row with a
  **new** object — `chatId: generationId`, fresh `time`, fresh
  `generationInfo`/`promptInfo` — irrespective of `useSayNothing`.
- **Consequence / repro:** `useSayNothing` off, streaming off, Continue an
  assistant reply, then export/reload: fork point shows the row re-keyed to the
  continue generation with new metadata; current keeps the original generation's
  id/metadata. ADJUDICATION.md marks CA-OR-7 `resolved` by `8bf88e43c`, but the
  resolution restores fork behavior only in the `useSayNothing=true` mode; the
  original divergence (recorded without any `useSayNothing` qualifier in
  `.archived-docs/audit/docs/orchestration-postgen.md:174-176`) persists for
  `useSayNothing=false` users.
- **Classification:** reported as adjudication-evidence; if fork-point parity is
  wanted for extend mode too, `candidate-fix` (remint identity on buffered
  extend); otherwise the CA-OR-7 row should be re-scoped to append mode only.
- **Confidence:** high.

## B-5 — Evidence: CA-OR-8 "resolved" describes text parity only — the double `editoutput` side-effect pass is still intentionally absent [low]

- **Current:** `server/fastify/src/prompt/assemble.ts:3114-3118` — comment
  "Accepted divergence (OR-6) … Keep the intentional single pass"; `editoutput`
  runs once over `continueBase + completion` (in append mode
  `continueBase='*says nothing*'`, reproducing the fork's *second* pass input, so
  the cutedog-class text outcome matches).
- **Baseline:** `index.svelte.ts:1635-1639` @baseline ran `editoutput` twice per
  buffered Continue (raw fragment at prospective index, then combined), so
  script **side effects** (Lua `editOutput` var writes, stateful regex effects)
  fired twice.
- **Consequence / repro:** a Lua `editOutput` hook incrementing a chat var runs
  twice per fork-point buffered Continue, once currently. ADJUDICATION.md lists
  CA-OR-8 as `resolved` by `8bf88e43c` ("restores baseline pass semantics"); the
  code restores the baseline *input text* of the effective pass, not the pass
  count. The adjudication row overstates the resolution.
- **Classification:** adjudication-evidence; recommend `keep` (re-introducing a
  deliberate double side effect is worse), with the CA-OR-8 row reworded.
- **Confidence:** high.

## B-6 — Durable generations stamp protocol metadata into persisted `generationInfo` that the fork point never wrote [med]

- **Current:** `server/fastify/src/routes/generationChat.ts:4519-4536` — every
  durable job's `generationInfo` (persisted on the assistant row via
  `buildAssistantMessage`, `generationChat.ts:2861-2877`, and the finalization
  write, `generationChat.ts:3347-3357`) additionally carries `databaseLineage`,
  `operationId`, `acceptedMessageId`, `attemptNo`, `jobId`,
  `effectLedgerKeyType`, `effectLedgerKeyId`, `effectLedgerCharacterId`,
  `effectLedgerChatId`. The startup sweep depends on reading it back from
  message JSON (`server/fastify/src/generationOperations.ts:1200-1218`;
  also `server/fastify/src/repository.ts:3482-3487`). Ordinary composer sends
  are durable by default, so this applies to essentially every new assistant
  row. Landed across protocol waves 1-3 (`43247b49e`, `09b70cc6f`,
  `1dd9f9123`) — all inside this delta.
- **Baseline:** `MessageGenerationInfo`
  (`src/ts/storage/database.svelte.ts:1820-1832` @baseline) is exactly
  `{model, generationId, inputTokens, outputTokens, maxContext, stageTiming}`.
- **Consequence / repro:** generate once, export the chat (or inspect
  message JSON): rows contain nine extra keys, including internal ids
  (`databaseLineage`, writer/job ids), which round-trip through chat exports and
  land in files shared with Original-Risu users. No UI-visible effect.
- **Classification:** `candidate-keep` — the recovery sweep and effect-ledger
  idempotency are keyed off this metadata, so removal is architectural; but it
  is persisted-transcript metadata (charter surface 1) and export-visible
  (surface 4), so it needs an explicit sign-off; an export-time scrub is the
  minimal alternative if clean round-trip is wanted.
- **Confidence:** high.

## B-7 — `/multisend` user rows gained `time` (and a client-minted `chatId`) [low]

- **Current:** `src/ts/process/command.ts:190-196` — protocol path stages the
  item string via `stageAcceptedSendGenerationOperation`, which builds
  `{role:'user', data, time: Date.now(), chatId: acceptedMessageId}`
  (`src/ts/server/generationOperations.ts:429-434`); the compat path uses
  `appendCurrentChatUserMessageForSend(string)` which also adds `time`
  (`src/ts/chatCommands.ts:5042-5048`).
- **Baseline:** `command.ts:174-177` @baseline pushed `{role:'user', data: e}` —
  no `time` (a `chatId` arrived later via the assembly backfill,
  `index.svelte.ts:854-855` @baseline). The **pre-delta** tree still matched the
  fork (`git show f2dc174f4:src/ts/process/command.ts`, multisend pushed
  `{role:'user', data: e}`); the change is in-delta (`d2df26e25`/`8c822bf35`).
- **Consequence / repro:** `/multisend a|||b`, then export: current rows carry
  `time`, fork-point rows do not. Cosmetic/metadata only (timestamps show in any
  UI that renders `time`).
- **Classification:** `candidate-keep` (consistent with composer rows; note that
  PO-file multisend rows already gained `time` pre-delta via the same helper).
- **Confidence:** high.

## B-8 — `/multisend` stops at the first failed generation; fork point kept appending and sending the remaining items [med]

- **Current:** `src/ts/process/command.ts:197` — `if (outcome.status !==
  'generated') break`; also a failed transcript `clear` aborts the loop
  (`command.ts:187-189`).
- **Baseline:** `command.ts:170-179` @baseline ignored `sendChat`'s result: after
  a failed generation the loop still pushed the next user row and sent again
  (and in `clear` mode re-wiped the transcript each iteration). Pre-delta
  (`f2dc174f4`) also did not check the result; the break is in-delta
  (`d2df26e25`).
- **Consequence / repro:** `/multisend a|||b|||c` with the provider failing on
  `a`: fork point ends with user rows `a,b,c` (+ any successful replies for
  `b`/`c`); current ends with only `a` (plus its recovery affordance). Durably
  stored transcript differs in row count and content.
- **Classification:** `decide` — recommend keep (continuing past a failure
  compounds errors and burns provider spend), but it is a real behavior change
  for STScript cards that rely on best-effort batching.
- **Confidence:** high.

## B-9 — PO-file multisend: sent text, final-entry handling, and export/download behavior all diverge from fork point (in-delta `53e59f420`) [med]

All in `src/ts/process/files/multisend.ts` vs baseline
`src/ts/process/files/multisend.ts`:

1. **Note marker text.** Current `:27`, `:133-135` matches `#. Note =` **and**
   `#. Notes =` and strips the marker. Baseline `:66-68` matched only
   `#. Note =` but replaced the string `'#. Notes ='` (a no-op), so the fork
   sent `Note: #. Note = <text>` — the marker literal was part of the persisted
   user row and of what the model saw. Current sends `Note: <text>`.
   → different durable user rows and different generated translations for every
   PO file using notes; `#. Notes =` lines, which the fork echoed into the
   exported file (fall-through at `:100`), are now consumed.
2. **Final entry flush.** Current `:169` flushes the last accumulated entry at
   EOF. Baseline only flushed on blank lines, so a file without a trailing blank
   line never sent its last entry (one fewer user/assistant pair persisted, one
   missing `msgstr` in the export).
3. **Failure handling / export gating.** Current `:94-108`, `:169-171` requires
   the send to be `generated`, resolves the assistant row **adjacent to the
   exact accepted user row** (`:42-53`, with strict re-hydration `:56-73`), and
   on any failure returns `false` — **no** `translated.po` download. Baseline
   `:48-58` read `message[length-1]` whatever it was and always downloaded at
   EOF: a failed generation exported the *user's own text* as `msgstr`, and the
   fork produced a (garbage/partial) file where current produces none.
- **Repro:** import a `.po` with a `#. Note =` line and no trailing newline;
  compare persisted rows and the downloaded file against the fork.
- **Classification:** `decide` — every sub-item fixes an obvious fork bug
  (recommend keep), but export content/shape (charter surface 4) and the
  persisted transcript both diverge for identical inputs.
- **Confidence:** high.

## B-10 — PO-file multisend no longer truncates at ~100 lines [low, pre-delta removal]

- **Current:** no line cap (`src/ts/process/files/multisend.ts:122-168`).
- **Baseline:** `multisend.ts:102-104` @baseline — `if(i > 100){ break }`
  ("prevent too long message in testing"), reached via any line that fell
  through to the default handler, so large PO files stopped being processed
  early.
- **Consequence:** for PO files past that boundary the fork persisted only the
  early entries' send/response pairs and a truncated export; current processes
  the entire file (more transcript rows, more provider calls, complete export).
- **Timing caveat:** the cap was already gone at `f2dc174f4` (pre-delta), so
  this is not a delta regression — recorded because it is user-visible,
  unrecorded in ADJUDICATION.md, and the delta commit `53e59f420` rewrote the
  surrounding flow.
- **Classification:** `candidate-keep` (the cap is an obvious leftover debug
  guard; keeping parity would mean re-truncating user data).
- **Confidence:** high.

---

## Areas swept and found clean

- **Composer send ordering on the atomic path** (`8c822bf35`): input trigger →
  append user row → `editinput` → run-vars is preserved. The accept transaction
  appends the exact staged row
  (`server/fastify/src/routes/generationOperations.ts:390-407`); assembly then
  excludes the just-appended row from the input trigger's view
  (`server/fastify/src/prompt/assemble.ts:1093-1102`) and applies `editinput` to
  it in place (`assemble.ts:1214-1256`), persisting the transform via
  `persistAssemblyMutations` (`generationChat.ts:2451`, `:4500`). Ordering matches
  `DefaultChatScreen.svelte:186-196` @baseline.
- **Say-nothing sentinel parity on plain sends:** same push condition
  (`DefaultChatScreen.svelte:1648-1651` vs baseline `:170-181`), same row shape
  (no `time`, `name:null` — `DefaultChatScreen.svelte:1653-1657`; the atomic
  staging spread adds only `chatId`, `generationOperations.ts:434`), sentinel
  persists durably on both sides, and the input-trigger/editinput bypass rides
  the atomic intent (`acceptedSendCoordinator.svelte.ts:284`,
  `routes/generationChat.ts:660-663`, `assemble.ts:2442-2448`).
- **Composer user-row shape:** `{role:'user', data, time, name:null}` matches the
  fork (`DefaultChatScreen.svelte:1662-1667` vs baseline `:191-196`); `chatId` is
  client-minted up front vs fork's assembly-time backfill — both UUIDs, no
  observable difference.
- **Atomic accept idempotency / ledger writes:** replayed submits never
  re-append (fingerprint + existing-projection check + `activeMessageIdExists`,
  `routes/generationOperations.ts:312-407`); the ledger, boot sweep, tombstone
  binding and recovery projections write **no** transcript rows — the only
  server `appendChatMessage` callers are the accept transaction and the legacy
  append command (`messageStore.ts`, `routes/commands.ts`); provider alternates
  go to the alternate-message store, not the transcript
  (`generationChat.ts:3385-3397`).
- **Buffered append-mode Continue success outcome matches the fork:** sentinel
  boundary replaced by a new assistant row with `chatId=generationId`, fresh
  `time`/`generationInfo`/`promptInfo`, `'*says nothing*'` continue-base through
  `editoutput`, same net row count and position (`assemble.ts:2726-2755`,
  `:3087-3126` vs baseline `index.svelte.ts:1648-1662`). Streaming extend-mode
  continue also matches (in-place `data` mutation, identity kept, both sides).
- **`useSayNothing` default backfill:** `true` when nullish on both sides
  (browser `database.svelte.ts:2890-2891`; server `databaseDefaults.ts:286`
  applied at load via `normalizeDatabaseDefaults` from `repository.ts`), so
  legacy server DBs stay in append mode.
- **Continue clears the reroll/alternate buffer** (the OR-7 stale-candidate bug
  is fixed): `generationChat.ts:3380-3397`; server reroll seeding only on
  successful terminal completion (`f372c0ee6`).
- **`/send`, `/sendas`, `/cut`, `/del` row shapes** unchanged vs fork
  (`command.ts:106-161` vs baseline `:104-158`); `/multisend clear` still wipes
  per-iteration like the fork.
- **Empty send with `useSayNothing` off** still generates without appending any
  row (`DefaultChatScreen.svelte:1719-1730`), as the fork did.
- **Non-streaming cancel persists nothing** (`generationChat.ts:4256`), matching
  the fork's pre-response abort for plain sends.

## Known/pre-existing items deliberately not re-reported

- CA-OR-3 (single-pass streaming `editoutput`; cancel keeps raw text), CA-OR-4,
  CA-OR-7/8 (except the partial-resolution evidence above), OR-1 (IGP race),
  OR-9 (`generationInfo` label/stage-timing), CA-OR-10 — adjudicated or open
  pre-delta findings.
- Pre-delta behaviors observed but out of delta scope: the appended user row is
  briefly visible with raw (pre-`editinput`) text and remains raw if generation
  fails mid-assembly (both true of the pre-delta compat path too); server-side
  input trigger also runs on *empty* non-sentinel sends where the fork ran none
  (OR-2-adjacent residual, pre-delta); PO multisend rows gained `time` pre-delta;
  extend-mode Continue over a trailing **user** row appends instead of
  replacing/extending it (pre-delta code shape).

## Could not verify

- No live execution: every finding is from source reading of both trees; the
  golden-transcript harness (charter stage 3) should confirm B-1/B-3/B-4
  matrix cells `{continue} × {stream, buffered} × {useSayNothing on/off}`.
- Reattach/epoch-recovery rendering of append-mode continue (`8bf88e43c`
  threads `continueDisposition` through `reattach.ts`/`bootstrap.ts`; unit tests
  cover it, not independently traced end-to-end here).
- Byte-exactness of the PO export for the all-success, well-formed-file case
  (structure looks identical by reading; not executed).
- DevTool autopilot and Plugin-V3 send entry points (no fork-point counterpart
  to compare against; both route through the same coordinator as B-7/B-8).
