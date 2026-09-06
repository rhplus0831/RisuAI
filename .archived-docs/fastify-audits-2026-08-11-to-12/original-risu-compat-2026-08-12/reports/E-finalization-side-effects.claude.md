# Brief E — Finalization order & script/lore/memory side effects (CLAUDE track)

Delta audited: `f2dc174f4..HEAD` (177 commits, 2026-08-04 → 2026-08-12).
Baseline: `/home/codex/risu-baseline-71c476e9c` (`@71c476e9c`).
All current-code citations verified at HEAD (`8bf88e43c`); all baseline citations
verified in the baseline worktree. Everything below is code-path analysis; no
live browser repro was run (see "Could not verify").

---

## E-1 — Output-trigger `sendAIprompt` resend now runs as an append-mode Continue and bakes a literal `*says nothing*` prefix into the follow-up assistant row

**Severity:** high (of the findings here; user-visible transcript corruption on
a real card pattern, default settings)

**Current behavior:**
- The output trigger's resend request rides the terminal frame
  (`server/fastify/src/prompt/assemble.ts:2565-2566`, `:3146`, `:3162` —
  `resendChat` is set only by `sendAIprompt`), and the browser re-issues it as a
  **Continue**: `src/ts/process/index.svelte.ts:654`
  (`continue: serverRequestedResend ? true : undefined`), which maps to server
  `mode: 'continue'` (`src/ts/process/serverBackedSendChat.ts:246`, `:623`).
- With `useSayNothing === true` (the fork-point **default**,
  baseline `src/ts/storage/database.svelte.ts:195-196`), `mode: 'continue'` now
  takes the 8bf88e43c **append** disposition
  (`server/fastify/src/prompt/assemble.ts:754-757`): a transient
  `*says nothing*` user boundary row is pushed (`assemble.ts:758-770`),
  `continueBase` is hard-set to the string `'*says nothing*'`
  (`assemble.ts:3087-3093`), and `editoutput` + persistence run over
  `'*says nothing*' + completion` (`assemble.ts:3117-3118`, `:3126`). Unless a
  card regex happens to strip it (the cutedog fixture does), the persisted
  follow-up assistant row literally begins with `*says nothing*` — pinned as
  expected behavior for durable jobs at
  `server/fastify/__tests__/durableGeneration.test.ts` ("`*says nothing* and
  they lived happily.`", added in 8bf88e43c).
- The resend prompt also now contains the transient `*says nothing*` user row
  and the `[Continue the last response]` marker (`assemble.ts:501`, `:792`) —
  an outgoing-payload divergence on the same path.

**Baseline behavior:** `src/ts/process/index.svelte.ts:1696-1702` +
`:1746-1765` `@71c476e9c` — `sendAIprompt` set `resendChat`, and the resend was
a **plain `sendChat(...)`** with no `continue` flag, no synthetic user row, and
no continue marker: the follow-up was a clean, freshly appended assistant row
containing only the new completion. The `*says nothing*` text existed **only**
in the UI empty-send handler (`src/lib/ChatScreens/DefaultChatScreen.svelte:170-182`),
never on the trigger-resend path.

**User-visible consequence / repro:** Card with a V1/V2 output trigger using the
send-AI-prompt effect (auto-chained replies); default settings. Send one
message. The automatic follow-up assistant message starts with the literal text
`*says nothing*` (and its request payload contained a says-nothing user turn +
continue marker the fork never sent). Same for Lua `onOutput` requesting a
resend.

**Classification:** candidate-fix — route server-requested resends as
`mode: 'send'`-style re-sends (the fork semantics), or at minimum exempt them
from the say-nothing append base. Note the *carrier* (`continue: true` on
resend) is pre-delta (`f25ee4df7`, 2026-06-01); the user-visible corruption is
activated by in-delta `8bf88e43c` making continue-with-useSayNothing an append
with a literal `'*says nothing*'` continueBase. Related pre-delta divergence
noted for completeness: resend depth is capped at 1
(`index.svelte.ts` `MAX_SERVER_RESEND_DEPTH`); the fork looped unbounded.

**Confidence:** high on the code path (every hop verified); medium-high overall
(not reproduced live; no test covers the resend+useSayNothing combination —
existing resend tests pin call counts only,
`src/ts/process/__tests__/sendChat.serverPreview.test.ts:1192`).

---

## E-2 — Post-generation script writes are dropped on live-state conflict instead of the fork's last-writer-wins (the `stale_generation_script_mutations` path)

**Severity:** medium

**Current behavior (in-delta, `f4356c498` + `ce5d74b18` + `492f99e9e` base):**
The finalization commit applies post-gen script writes only if each target still
equals its post-assembly baseline, else drops them and emits one SSE warning:
- chat variables — per-key drop
  (`server/fastify/src/routes/generationChat.ts:3096-3123`);
- character fields (Lua `setName` / `setCharacterFirstMessage` /
  `setBackgroundEmbedding`) — per-key drop (`generationChat.ts:3144-3162`);
- chat-local lorebook (Lua `upsertLocalLoreBook`) — whole-collection drop on any
  concurrent `localLore` change (`generationChat.ts:3207-3223`);
- warning surface `generationChat.ts:2086-2099`
  (`kind: 'stale_generation_script_mutations'`), replay path identical
  (`generationChat.ts:3870-3877`).
Additionally the `before` values are baselined at post-assembly time
(`server/fastify/src/prompt/assemble.ts:3103-3112`), so the run-var pass /
output trigger compute against the request-time snapshot, not live state.
The **assembly-stage** analogue is stricter: a stale value there throws and
fails the generation (`generationChat.ts:1564-1578`, `:3129-3142`,
`:3190-3205`) — a failure mode the fork did not have at all.

**Baseline behavior:** `src/ts/process/index.svelte.ts:1605-1613` /
`:1693-1702` `@71c476e9c` — run-vars (`runCurrentChatFunction`, `:112`) and the
output trigger read **live** `DBState` at finalize time (a mid-stream user edit
was incorporated into the computation) and wrote back unconditionally
(last-writer-wins); Lua setters wrote `DBState` immediately
(`src/ts/process/scriptings.ts:629`, `:674`, `:715`, `:762`).

**User-visible consequence / repro:** While a generation streams, edit a chat
variable (or the character card / chat lorebook). At finalization the script's
write to that key is skipped with only a toast-level warning; the fork applied
it (computed over the edited value). Conversely a concurrent edit during the
brief assembly window fails the whole generation with a validation error the
fork could never produce.

**Classification:** decide (leaning candidate-keep) — the fence exists to stop
cross-write clobbering under the command/revision model and multichat, and
`f4356c498` explicitly chose drop-the-write over drop-the-message. But
drop-vs-apply on user-edit races is a genuine behavior change on the
script-visible-state surface, so under the new bar it needs an explicit
sign-off rather than inheriting the old "saner" blanket.

**Confidence:** high (mechanics fully code-verified on both sides; race
frequency in practice not measured).

---

## E-3 — Queued/rejected finalization envelope: a commit-failed generation can later be terminally dropped — message *and* all its side effects — if the transcript moves first

**Severity:** medium (failure-path only; needs a real SQLite commit failure to
arm)

**Current behavior (in-delta, `4abc6d1c0` + `ce78d75d2`):** When the
authoritative commit fails after the journal insert succeeded, the terminal is
an **error frame** with `persistenceDisposition: 'queued'`
(`server/fastify/src/routes/generationChat.ts:4067-4121`); the browser raises
the error, marks the row provisional
(`src/ts/process/serverBackedSendChat.ts:751-763`), and a sweep retries with
5s→5min capped backoff indefinitely
(`server/fastify/src/generationFinalizationRetry.ts:11-13`). The replay applies
the *journaled* message + chatVar/characterField/localLore envelope (values
identical to what the live commit would have written —
`generationFinalizationRetry.ts:103-133`, `generationChat.ts:3521-3556`), so a
clean replay is value-parity. **But** the replay is fenced by the assembly-time
snapshot: any transcript change in that chat before the replay lands (new send,
tail edit/delete) makes `validateGenerationFinalizationTargetFresh` throw
(`generationChat.ts:3006-3021`), which is classified terminal
(`generationChat.ts:3517-3519`, `:3652`) — the generated message, its variable
writes, lore writes and character-field writes are permanently not applied;
only a retained journal row / stalled indicator remains (journal rows are never
pruned, per `ce78d75d2`). Pre-existing NULL-snapshot retries from restored
backups are quarantined as `stalled_legacy` and never replay (`4abc6d1c0`).

**Baseline behavior:** no equivalent state exists. The fork applied every
side effect synchronously to in-memory `DBState`
(`src/ts/process/index.svelte.ts:1626-1703`) and could not lose a completed
generation after the fact; a failing IndexedDB save affected persistence of
*everything*, not one generation.

**User-visible consequence / repro:** Force a commit failure (disk error) on a
send; keep chatting in that chat within the backoff window; the queued message
turns terminally stalled and its text/vars never land. The fork-point user
would have seen everything applied immediately.

**Classification:** candidate-keep — this is the maintainer-approved MS-05
phase-aware policy (2026-08-11) and is unreachable without a genuine
persistence fault; listed so the "user keeps typing → terminal drop" corner is
signed off explicitly rather than implicitly.

**Confidence:** high (code-verified; failure injection not exercised here —
covered by `server/fastify/__tests__/durableGeneration.test.ts` /
`generationFinalizationRetry.test.ts`).

---

## E-4 — Effect-ledger classification: ephemerals are permanently skipped after any late claim — including a queued→committed replay the user watched live

**Severity:** low

**Current behavior (in-delta, `1dd9f9123`):** Classification at
`server/fastify/src/generationEffects.ts:23-31`: durable = `igp`,
`plugin_output`, `generated_translation`; ephemeral = `notification`, `tts`,
`completion_sound`; recomputed = `emotion_image_state`. A `late_recovery` claim
on an ephemeral is atomically converted to a **permanent skip**
(`generationEffects.ts:325-334`). Every recovery/reconcile path claims with
`late_recovery` (`src/ts/process/recoveredGenerationEffects.ts:68-75`) —
including the 5-second live refresh loop that picks up a queued finalization
committing while the user is still watching
(`src/ts/process/generationPersistenceState.ts:30`, `:47-68`). So for a
finalization that was queued for a few seconds and then committed, the
completion notification / auto-TTS / completion sound never fire, even at a
live terminal; IGP and translation do replay (exactly once, fenced by
`expectedData` — `src/ts/process/postGeneration/igp.ts:43-95`).

**Baseline behavior:** ephemerals always fired at completion — TTS
`src/ts/process/index.svelte.ts:1622-1624` / `:1684-1686`, notification
`:1767-1781`, completion sound
`src/lib/ChatScreens/DefaultChatScreen.svelte:324-327` `@71c476e9c`.

**Answer to the brief's direct question:** none of the effects classified
`ephemeral` mutated durable state at the fork point — notification used the
Notification API only, TTS was audio, the completion sound was audio, and
`emotion_image_state` fed a non-persisted in-memory store
(`src/ts/stores.svelte.ts:29` `@71c476e9c`), so `recomputed` is parity-safe.
`plugin_output` has no fork-point counterpart (no output-listener API at
`71c476e9c`; added post-fork by `044add8cd`). Nothing durable at the fork is
silently dropped on recovery. Two micro-nuances: (a) the fork played the
completion sound even when the send **failed** (it sat after the try/catch);
current plays it on success only (`src/ts/process/index.svelte.ts:665-669`);
(b) fork IGP appended unconditionally to whatever row was last, current skips
when the target row changed (`skippedGenerationEffect('target_changed')`) —
guarded behavior replacing a fork mis-append.

**Classification:** candidate-keep (MS-06 AV-03 maintainer policy 2026-08-11);
the "live queued→committed replay still counts as late" corner is the one
detail worth an explicit nod.

**Confidence:** high.

---

## E-5 — Lua durable character/lore writes: value parity holds; envelope differences are timing, conflict-drop, and minted lore IDs

**Severity:** low

**Current behavior (`492f99e9e` pre-delta base; in-delta `ce5d74b18`):**
`setName`/`setCharacterFirstMessage`/`setBackgroundEmbedding`/`upsertLocalLoreBook`
persist through before/after envelopes — input-stage writes at assembly persist
(`server/fastify/src/routes/generationChat.ts:1498-1646`, including the
`ce5d74b18` localLore adoption at
`server/fastify/src/prompt/assemble.ts:1148-1153`), post-gen-stage writes at
finalization (E-2's drop semantics). Written values are byte-identical to the
fork's setters. Deltas vs fork: (a) UI visibility of a rename lands at
finalization/assembly-persist rather than instantly mid-hook; (b) id-less or
duplicate-id legacy `localLore` entries get UUIDs minted at persist
(`generationChat.ts:3164-3188`) — the fork left entries id-less
(`src/ts/process/scriptings.ts:762` `@71c476e9c` and the fork's lore shape), so
persisted/exported chat JSON gains `id` fields the fork never wrote; (c) writes
from a generation that fails post-assembly are kept for the input stage
(matches fork — the fork had already applied them) and never applied for the
post-gen stage (also matches fork — `editoutput`/output-trigger never ran on a
fork failure/abort either).

**Baseline behavior:** immediate durable `DBState` writes at hook time,
last-writer-wins (`scriptings.ts:629`, `:674`, `:715`, `:762` `@71c476e9c`).

**User-visible consequence / repro:** rename via Lua `onInput`: fork shows the
new name during generation; current shows it moments later (post assembly
persist) — transient. Export a chat whose lore was touched by Lua: entries now
carry `id` fields. Round-trips into Original Risu fine (unknown fields are
tolerated / ids are the modern shape).

**Classification:** candidate-keep (these are the ST-3 fix's designed
semantics; the conflict-drop arm is adjudicated under E-2's decision).

**Confidence:** high.

---

## E-6 — Stage-4 verification notes on `8bf88e43c` (adjudicated rows CA-OR-7/CA-OR-8 — not re-reported, detail only)

**Severity:** informational (these rows are `resolved` in ADJUDICATION.md;
listed because Stage 4 says it will verify the flip and these are the exact
residuals).

1. **Append mode is faithful to the fork's dominant path.** Fork Continue with
   `useSayNothing=true` (default) pushed a `*says nothing*` user row
   (`DefaultChatScreen.svelte:139-141`, `:170-182`, `:213`, button `:906-917`)
   and then `sendChat({continue:true})` **replaced that row** with a char row
   whose text was `editoutput('*says nothing*' + completion)`
   (`index.svelte.ts:1634-1661` `@71c476e9c`). Current reproduces this,
   including the prefix through `editoutput` and the generation-owned row
   identity (`assemble.ts:754-770`, `:2726-2752`, `:3084-3126`). Verified
   equivalence, including the surprising persisted `*says nothing*` prefix when
   no script strips it (both sides).
2. **Extend mode residual:** with `useSayNothing=false` the fork still replaced
   the extended row with a **new** identity (fresh `chatId`/`time`/
   `generationInfo`, `index.svelte.ts:1649-1657`); current keeps the old row
   identity/metadata (`assemble.ts:2729-2732`,
   `generationChat.ts:1719-1722`). This is the deliberate dual-mode gating the
   charter blesses; noting it so Stage 4 confirms it is intentional for the
   non-default arm.
3. **Streaming append-continue role quirk:** the fork's streaming Continue
   mutated the says-nothing **user** row's `data` in place and never changed
   its role — the final continued reply persisted as `role: 'user'`
   (`index.svelte.ts:1533-1537`, `:1582-1583` `@71c476e9c`). Current persists a
   proper `role: 'char'` generation-owned row
   (`src/ts/process/postGeneration/streamResponse.ts:128-133` + server
   append). Almost certainly a fork bug; candidate-keep, but it is a
   persisted-transcript-shape divergence under the strict bar.
4. **`editoutput` remains single-pass** on buffered Continue in both modes
   (comment at `assemble.ts:3114-3116`); the fork ran it twice (discarded first
   pass at the un-decremented index, `index.svelte.ts:1635-1639`). CA-OR-8's
   "resolved" is via the cutedog rule working under single-pass, not via
   restoring double side-effect execution (a Lua `editOutput` that counts
   invocations still sees 1 vs the fork's 2 per buffered Continue).
5. Minor: the transient boundary row always carries `name: database.username`
   (`assemble.ts:763`); the fork set `name` only when the multiuser connection
   was open, else `null` (`DefaultChatScreen.svelte:177`). Prompt-payload-only
   (the row never persists in current code).

---

## E-7 — `67210c623` rode a (parity-restoring) behavior change alongside its warnings

**Severity:** low

**Current behavior:** besides the additive V1/V2 unsupported-effect banners and
SSE warnings, the commit made `{{screenwidth}}` and
`{{metadata::browserlanguage}}` actually **resolve** server-side from
client-reported context (`server/fastify/src/prompt/cbsAdapter.ts:75-93`,
`:149-151`; `src/ts/process/request/clientContext.ts`), where they previously
threw/returned nothing on the server. That is a parity **restoration** toward
the fork (`src/ts/cbs.ts:1369` `@71c476e9c` — `window.innerWidth`), so the
"warnings must be additive" check passes with this one deliberate rider.
Residuals: `{{screenheight}}` deliberately returns `''` + warning
(fork returned `window.innerHeight`) — already tracked as deferred CA-DF-1;
and the browser-language pattern gate
(`clientContext.ts` `BROWSER_LANGUAGE_PATTERN`) drops non-BCP47-ish locales
(e.g. underscore forms) to `''` where the fork forwarded `navigator.language`
verbatim; the 100 000px width clamp is unreachable in practice. No other
behavior change found in the commit's server diff (trigger/variables changes
are context plumbing only).

**Classification:** candidate-keep (rider is toward parity; locale-pattern edge
is negligible but listed for completeness).

**Confidence:** high.

---

## Areas swept and found clean

- **Finalization order is unchanged by the delta**: `editoutput` →
  insertion/extension → run-var pass → output trigger → atomic persistence
  (`assemble.ts:3080-3166`); the delta's diffs to this function are the
  continue-disposition branches (E-1/E-6), warning plumbing, and the
  `ce5d74b18` lore adoption only. Input trigger still does not run for
  Continue (`assemble.ts:1089`), matching the fork.
- **Effect exactly-once accounting** (`1dd9f9123`): ledger rows are created in
  the same transaction as the commit (`generationChat.ts:3430-3446`), claims
  are atomic and idempotent, settle requires the claim id, pre-ledger
  terminals are back-filled as conservative skips
  (`generationEffects.ts:386-440`) — no path found where a fork-point side
  effect runs twice; the normal (non-queued) live path claims everything
  `live_terminal` and runs it exactly as before.
- **TTS parity** (fork OR-8 class): the terminal TTS side effect speaks the
  post-`editoutput` text with browser inlay processing, one utterance per
  provider choice in order (`serverBackedSendChat.ts:888-902`) — matches fork
  buffered semantics (`index.svelte.ts:1644-1646`, `:1684-1686`).
- **IGP ordering**: still after derived terminal text, before notification /
  emotion (fork order preserved); the append is fenced + durable via the
  message-command path (`index.svelte.ts:603-616`, `igp.ts:68-95`). (The
  fork's own IGP appended `[object Object]` — that repair is pre-delta,
  stability-audit I11/L34, closed; not re-reported.)
- **Hypa V3 (`ecf470b04`)**: for the same chat history the stored summaries are
  unchanged — the commit's server diff is projection identity, versioned
  event/snapshot plumbing, and cancel-abort; the summarization prompt, chunking
  and persistence values are untouched. New behavior is strictly: a
  user-initiated cancel now actually aborts the in-flight provider batch, and a
  cancelled job can no longer persist its summary
  (`memorySummarizeJobHandler.ts` post-execute status guard) — no fork analog
  (fork had no cancellable deferred memory; deferral itself is adjudicated
  CA-LM-2). Client `hypav3.ts` changes are progress-identity only.
- **Cancel finalization**: streaming cancel persists raw accumulated text with
  no post-gen pass and empty post-gen mutation envelope
  (`generationChat.ts:4261-4312`) — matches the fork, which never reached
  run-vars/output-trigger on abort (`index.svelte.ts:1599-1601`); assembly-stage
  writes survive cancel on both sides (fork: already applied; current: assembly
  persist ran pre-dispatch).
- **Raw-fallback on post-gen derivation failure** (`generationChat.ts:2010-2063`)
  drops only *post-gen-stage* mutations (assembly-stage writes were already
  persisted) — the remaining skip-stages behavior is adjudicated CA-OR-1
  (`fix`), no new delta on it.
- **`generated_translation`**: server-owned, durable, restart-reconciled
  exactly-once; the underlying client→server migration is pre-delta with its
  own standing adjudication; the delta only adds recovery. No double- or
  dropped-translation path found.
- **Lua runtime delta additions** (`getRecentChats`, `setStateChanged`,
  `getChatData`/`getChatRole`, `halfStreaming:false` in Lua LLM) are
  upstream-sync API surface, not fork-point behavior changes.
- **`67210c623` trigger-side diff** beyond E-7: pure context plumbing +
  additive diagnostics; V2 import keeps definitions intact.

## Could not verify

- No live end-to-end repro of E-1 (code-path certainty only; recommend a pin
  test for `sendAIprompt` + `useSayNothing=true` before/while fixing).
- Whether real cards in the wild rely on `sendAIprompt` resends (impact
  breadth of E-1) — pattern exists, prevalence unmeasured.
- UI rendering of the queued/stalled indicators (ce78d75d2 client components)
  was not exercised; behavior taken from code + tests.
- Group-chat arms of every path (standing no-port CA-OR-2).
- Actual frequency of E-2 conflict drops under real concurrent editing; only
  the mechanism was verified.
- `plugin_output` semantics against its own spec (`044add8cd` is post-fork
  feature work; outside fork-point parity, checked only for ledger
  exactly-once).
