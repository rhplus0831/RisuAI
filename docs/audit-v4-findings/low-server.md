# V4 Audit — Low-Severity Findings: Server (Detail)

Full-detail companion to `../audit-stability-and-performance-v4.md` for the
server-area low-severity findings L1-L16. The IDs, titles, and severities in
the main document are canonical; this file expands the mechanism, trigger, and
verifier corrections behind each row. Line numbers were captured at the audit
window (round-1 finders read `4ccc15194`; verification re-checked the working
tree between `18cc05099` and `b355586a6`) and will drift — the symbol names
are the durable anchors.

## L1 — Durable `continue` persists assembly-time snapshot text over a concurrent mid-generation edit (`baseRevision` captured at PERSIST time, not assembly time)

- Severity: low · Category: stab · Area: server
- Finder: `concurrency-server`, claimed low, confidence high
- Verification: confirmed (lone skeptic), severity held low
- Novelty: new
- Location: `routes/generationChat.ts`
  `resolvePostGenerationResult` / `buildRawModeMessage` (continue branch
  ~`:706-727`); `persistServerGenerationResult` `:1226` (`baseRevision`
  capture via `getSchemaState(args.db)`); `writeGenerationChatMessage`
  (`targetMessageId = continueRow.chatId`, ~`:1236-1250`); `continueRow`
  captured from the assembly-time `AssemblyState` via `findContinueRow`
  (~`:686-688`); state snapshot taken at `loadPersistedForAssembly`
  (~`:357-366`).

**What.** For `mode='continue'` the durable runner derives the persisted
assistant text from the assembly-time snapshot: `data = (continueRow.data ??
'') + completionText`, where `continueRow` is the last `char` row in
`successfulResult.state.currentChat.message`, captured when
`loadPersistedForAssembly` ran at the START of assembly. The provider stream
then runs for seconds-to-minutes — an `await` window. At completion,
`persistServerGenerationResult` calls `writeGenerationChatMessage(targetDb,
chatId, record, targetMessageId = continueRow.chatId)`, which looks up the
existing row by id and REPLACES it in place with the snapshot-derived text;
the `existing` SELECT is used only for seq/duplicate/displaced resolution,
never to compose with the row's current data. If the user edits that same
message during the generation (via `dispatchUpdateMessageScoped` →
`updateActiveMessageById`, a `messages.update` command), the edit commits
fine, then the durable continue persist overwrites it with `(pre-edit base
text) + completion`, discarding the edit. The skeptic sharpened *why the
revision machinery does not catch it*: `persistServerGenerationResult`
captures `baseRevision` via `getSchemaState(args.db)` at `:1226` — at PERSIST
time, not assembly time — and `applyTargetedCommandMutation` re-reads
`currentRevision` microseconds later in the same synchronous `BEGIN IMMEDIATE`
block (`mutations.ts:220-223`). The intervening edit lands during the `await`
window BEFORE `:1226`, so by persist time `baseRevision === currentRevision`
and the guard passes. The guard only protects against a race INSIDE the
synchronous persist, never across the generation window.

**Impact / trigger.** Lost edit confined to exactly the one continued
message. Trigger: the user edits the in-progress continue-target row while a
durable `continue` runs — realistically only via a second tab, since the
originating tab streams into that row. Frequency: rare, single-user
self-inflicted. Does not scale with corpus or transcript. The loss is durable
on BOTH sides: the client `done.postGeneration` frame writes the
snapshot-derived `finalText` (`continueBase + completion`) onto the local row
(`serverChatEvents.ts:161-165`), so the edit is lost in the projection too,
not just on disk. `send`/`regenerate` are unaffected (send appends a fresh row
by `generationId`; regenerate intentionally replaces the target). The
per-message edit UI is not gated on `$doingChat`, and the one-job-per-chat
lock blocks a second *generation* but not a `messages.update` command.

**Verifier notes.** The skeptic confirmed continue is durable-eligible and the
live client always sends `durable:true`. The fix reuses an existing helper and
matches the route's stated "gotcha C — composes with any intervening edits"
intent that already holds for `scriptstate`. Distinct from the v2-dismissed
"promptScope concurrent-assembly race" (racing assemblies, not a continue
persist clobbering a committed edit) and the v1-dismissed "inline
continue/regenerate disconnect loss" (disconnect, not concurrent edit).

**Fix.** Re-read the continue-target row text from the fresh `targetDb` inside
the `persistServerGenerationResult` mutate callback rather than carrying
`continueRow.data` from the assembly snapshot: locate the row by
`continueRow.chatId` via `getActiveMessageLocationById` and append the
completion to its CURRENT data, falling back to the snapshot only when the row
is gone. This composes the completion onto any intervening edit instead of
clobbering it.

## L2 — `continue`'s `done.finalText` carries the WRONG row after a start-trigger reshapes the transcript tail

- Severity: low · Category: stab · Area: server
- Finder: `hostile-send-server`, claimed low, confidence medium
- Verification: confirmed (lone skeptic), severity held low
- Novelty: new
- Location: `prompt/assemble.ts:1901-1971` (`runServerPostGeneration`
  continue branch: `continueIndex = messages.length - 1` ~`:1922-1928`,
  `assistantTextAfterPass` returns `messages[continueIndex]?.data`
  ~`:1901-1915`); start-trigger transcript mutation via `:1146-1203`
  `fillHistoryAndBias` → `history.ts:504-522` `runStartTrigger`; consumer
  `routes/generationChat.ts:1453/1519`.

**What.** For `continue`, `runServerPostGeneration` assumes the last
transcript row is the char row being continued: `continueIndex =
messages.length - 1`. If that row is not a char row, `continueBase` is `''`
and `appendAssistantRow` pushes a NEW char row at the end, but
`assistantTextAfterPass` still reads `messages[continueIndex].data` — the OLD
non-char row — and returns it as `finalText` on the `done` frame. The
persisted message is correct (`resolveInlineGenerationMessage` /
`findContinueRow` reverse-find the new char row), but the wire `finalText` the
browser reconciles is wrong. The UI gates the continue button on the last row
being `char`, but a start trigger running during continue assembly
(`cutchat`/`impersonate`/`modifychat`) can reassign `state.currentChat` so the
post-gen tail is a user row even though the client-side gate passed — the
server does not re-verify. The skeptic corrected which path is live: the live
client always sends `durable:true`, so the relevant path is
`buildDurablePostGeneration` (not the inline `buildPostGenerationFrame` the
finder anchored), but BOTH share `resolvePostGenerationResult` +
`buildPostGenerationFrameBody`, so the durable path carries the identical bug.
The wrong `finalText` is the impersonated user-row text (or whatever row
`cutchat`'s slice leaves at the tail), not literally "the previous user/other
row."

**Impact / trigger.** On a continue where a start trigger reshapes the tail to
end on a non-char row, the browser receives `done.finalText` equal to the
wrong row's text. The skeptic sharpened the consequence: the client does not
merely "reconcile" — `serverBackedSendChat.ts:462-464` OVERWRITES the local
assistant row's data with `runInlayScreen(finalText)`, so the just-continued
message visibly shows the wrong text in the projection; the bumped revision
(`serverChat.ts:446`) is only synced into the cached command revision, NOT
used to re-hydrate, so the divergence persists until the chat is reloaded. No
crash, no data loss (the persisted row is correct). `finalText` only rides the
done frame when `textChanged` is true, which is effectively always true in
this case. Narrow trigger: `continue` mode + a start trigger that mutates the
trailing transcript; confined to the trigger/scripting opt-in subsystem on a
non-default action; self-heals on reload.

**Verifier notes.** `runStartTrigger` runs for ALL modes including continue
(no mode gate); start-trigger mode has NO effect allowlist (only
display/request modes filter), so `impersonate` (pushes a `user` row) and
`cutchat` (slices) reshape the assembler-state tail. `buildMemoryWindow`
returns the same `currentChat` ref, so `state.currentChat.message` is the full
reshaped transcript at post-gen. The assembly-time reshape reaches the client
via `captureMessageReplacement(state,'start_trigger')` emitted as a
`message_patch`.

**Fix.** Recompute the continue target by identity after post-gen rather than
by the stale `continueIndex`: in `assistantTextAfterPass`, for continue prefer
the row whose `chatId` matches the continued row id (capture it before
`appendAssistantRow`) or fall back to the appended `generationId` row,
mirroring the non-continue `find(chatId === generationId)` branch.
Alternatively guard `continueIndex` to apply only when
`messages[continueIndex]?.role === 'char'`, else treat as an append.

## L3 — Post-takeover cancel DELETE is 423-blocked AND the client never inspects the response (silent Stop no-op)

- Severity: low · Category: stab · Area: server
- Finder: `concurrency-server`, claimed medium, confidence medium
- Verification: confirmed (lone skeptic), calibrated medium→low
- Novelty: new
- Location: `routes/generationChat.ts` DELETE
  `/api/v1/generate/chat/:id` handler (~`:1896-1909`); active-writer gate via
  `routeManifest.ts:546-559` (`generation-chat-cancel`,
  `activeWriter:'active-writer'`) enforced in `registerActiveWriterGuard` →
  `requireActiveWriter` (`activeWriter.ts:21-41`); writer takeover on every
  `/bootstrap` (`bootstrap.ts:25-27` `registerActiveWriterSession`); client
  `serverChat.ts:127-141` (`cancelServerChatGeneration`, no `response.ok`
  check).

**What.** `registerActiveWriterSession` sets `state.sessionId` to whichever
session most recently hit `/api/v1/bootstrap`, so a second tab loading the app
becomes the active writer mid-generation. The cancel route is
`activeWriter:'active-writer'`, so its preHandler compares the request's
`risu-writer-session` header to `state.sessionId`; the original tab (session
A) issuing its own cancel now mismatches the new active writer (session B) and
gets 423 `active_writer_stale`. The durable job was authorized at submission
(`writerSessionId` captured then, never re-checked at completion), so it keeps
running and finalizes; only the explicit user-driven cancel is blocked. The
skeptic added the sharper, worse half: the client does NOT surface the 423 —
`cancelServerChatGeneration` fires the DELETE with only a `try/catch` around
`fetch`; a 423 is a resolved non-ok `Response` the code never inspects (no
`response.ok` check) and never passes to `handleActiveWriterStaleResponse`. So
the Stop button silently no-ops with zero feedback. Every other 423-aware path
(stream POST/GET, commands, assets, backups) DOES call
`handleActiveWriterStaleResponse` → full page reload; the cancel path is the
lone exception.

**Impact / trigger.** User-visible "cannot stop generation" after opening a
second tab during a generation. No data corruption (the generation persists
normally). Trigger: open/reload a second tab while a durable generation runs,
then try to cancel from the first tab; the takeover tab's own Stop works
(its session is current) — only the originating tab is wedged. Frequency:
rare; requires the multi-tab handoff to land inside a generation. The skeptic
corrected the bound: the job is created with `slidingDeadline:true`
(`:1807`); `refreshDeadline` resets `deadlineAt` to `now+600s` on every token
activity frame (`isStreamDeadlineActivityFrame`, `streamJobs.ts:295-319`), so
an uncancellable runaway is bounded by 600s of SILENCE, not 600s of
wall-clock — it can run much longer while still emitting tokens.

**Verifier notes.** The job records `writerSessionId` at submission
(`:1811`) but nothing on the cancel path consults it, so the proposed fix is
sound and the data is already present. No silent auto-retry exists on the
cancel path (unlike the reload-and-retake mutations). Distinct from v3-I1
(manifest scan cost) and the section-B reattached-observer reconciliation
item. The skeptic seated this at low (not info): a real correctness defect on
a user-facing control reachable on a routine init path, no feedback; not
medium (needs the narrow tab2-load-during-tab1-generation overlap, no
corruption, job still persists/completes).

**Fix.** Authorize cancel by the job's recorded `writerSessionId` (the
identity that submitted it) rather than the current global active writer —
accept the cancel when the request's `risu-writer-session` matches
`job.writerSessionId` OR the current active writer. Independently, make
`cancelServerChatGeneration` inspect `response.ok` and route a 423 through
`handleActiveWriterStaleResponse` so the Stop control surfaces the takeover.

## L4 — Durable replay truncation fires at the 512-EVENT cap, far below the 2 MB byte cap

- Severity: low · Category: stab · Area: server (cross)
- Finder: `durable-job-state-machine`, claimed info, confidence medium
- Verification: confirmed (lone skeptic), UPGRADED info→low
- Novelty: new
- Location: `streamJobs.ts:203` `appendDurableReplayFrame` (drops
  `droppable` token frames once over `PROXY_STREAM_MAX_PENDING_EVENTS=512` /
  `PROXY_STREAM_MAX_PENDING_BYTES=2MB`; `DURABLE_REPLAY_PROTECTED_EVENTS`
  keeps `done`/`error`/`info`/`prompt`/`message_patch`/`side_effect`/
  `warning`), `:215-225`; attach replay `:352`; client `serverChat.ts:437-442`
  (`done` handler only applies `donePayload.result` when
  `tokenResult.length === 0`).

**What.** For a durable job with no attached viewer, `pushRaw` routes frames
only into the bounded replay buffer (the `clients.size === 0` short-circuit).
`appendDurableReplayFrame` prunes the OLDEST droppable frames — `token` frames
are NOT in `DURABLE_REPLAY_PROTECTED_EVENTS` — once the buffer exceeds 512
events or 2 MB. On reattach, `JobRegistry.attach` replays whatever survived.
The client accumulates replayed tokens into `tokenResult` and, in the `done`
handler, applies the authoritative full text `donePayload.result` ONLY when
`tokenResult.length === 0`. After a partial token drop `tokenResult` is
non-empty-but-incomplete, so the full result is NOT applied and the live
message shows truncated text. The persisted server-side result is correct
(the server persisted the full completion), so this is display-only. The
finder named the 2 MB byte cap as binding; the skeptic corrected the trigger
by orders of magnitude: the 512-EVENT cap fires first, because each upstream
provider delta becomes exactly one `token` SSE frame (`openai.ts:345-346`
yields one token frame per non-empty delta; `emitProviderChunks`
`providerTransport.ts:79-83`), so any normal multi-paragraph reply exceeding
~512 deltas (a few hundred tokens) already overflows and starts dropping the
oldest tokens. So the response-size gate is routine, not "hundreds of
thousands of tokens."

**Impact / trigger.** Transient wrong live display on reattach. The real
rarity gate is the reattach-mid-generation sequence (tab reload/disconnect
during streaming, then reattach via `maybeReattachOpenChatGeneration`), not
the response length. The skeptic corrected the self-heal claim: it does NOT
self-heal right after the reattach completes — the durable path persists
server-side and the browser issues no result command and forces no resync; the
truncated `assistant.data` persists in the local display until a later
projection resync (`forceServerProjectionResync` → `hydrateActiveChat`)
re-hydrates the chat. Display-only, no data loss.

**Verifier notes.** Adjacent to but distinct from the `leftover.md` "streaming
cancel terminal frame does not reconcile" open decision (Section B), which is
cancel-specific and about the omitted revision; this is a successful-completion
token-loss display bug gated on the client's `tokenResult.length === 0`
guard. The skeptic upgraded from info because the misleading-display window
opens on routine-length responses (512-frame cap), with a clean one-line fix
available.

**Fix.** On the `done` frame, always trust `donePayload.result` when present
for a reattached stream (drop the `tokenResult.length === 0` guard), or
surface a job `replay_truncated` flag analogous to `pendingOverflow` and apply
the full result whenever the server marked the buffer as having dropped
frames. Reuse the existing `setCachedServerCommandRevision` reconciliation
already done on the same done frame.

## L5 — `makeMs` builds the reversed history window with `unshift` in a loop (O(N²))

- Severity: low · Category: perf · Area: server
- Finder: `complexity-server`, claimed medium, confidence high
- Verification: confirmed 3-0, calibrated medium→low (median low; one
  lens info)
- Novelty: new
- Location: `prompt/history.ts:462-475` `makeMs` (`mss.unshift(d)` at
  `:472`), called from `buildHistoryWindow` at `:476` and again at `:508`
  after the start trigger.

**What.** `makeMs` walks `chat.message` newest-to-oldest and prepends every
non-disabled row with `mss.unshift(d)`. `Array.prototype.unshift` is O(current
length) because every existing element shifts up one slot, so building an
M-element list costs O(M²). It runs over the ENTIRE persisted transcript (the
budget trim in `buildMemoryWindow` happens later in `fillMemoryAndPostHistory`,
after the full history walk), and `buildHistoryWindow` invokes it twice per
send — once at `:476`, again at `:508` after `runStartTrigger`. The liveness
lens corrected the "twice per send" claim: the second `makeMs` runs only when
`runStartTrigger` returns a non-null result, which it does only when the
character + active modules declare triggers; for a default chat with no
triggers — the common case — `makeMs` runs ONCE per send. This is a faithful
port of the SPA's `n()` closure (`buildHistoryWindow.ts:90-99`, same
`mss.unshift`), so not a regression.

**Impact / trigger.** Every server-side chat send. Scaling: quadratic in the
number of non-disabled messages. At a few hundred messages negligible; the
finder's "tens of millions of element shifts blocking the event loop" framing
overstates the wall-clock cost because V8 implements `unshift` element-movement
as a `memmove` with a tiny constant.

**Verifier notes.** All three lenses confirmed the O(N²) is real (measured
ratio vs an O(N) push+reverse grew 4.6× at N=500 → 23.6× at N=5000 → 77× at
N=10000, confirming quadratic), but the absolute wall time is small: 0.066 ms
at N=1000, 0.194 ms at N=2000, 1.18 ms at N=5000, ~5.4-5.49 ms at N=10000 per
`makeMs` call. Two lenses calibrated to low, one to info, on the basis that the
unshift is only ~5-15% of the surrounding mandatory linear per-message work —
`structuredClone(currentChar.chats[chatPage])` measured ~5.6 ms at N=5000, and
each kept message then runs `formatHistoryMessage` (CBS parse, regex
`processScript`, inlay/asset scans) plus a real tiktoken `tokenizeChat` BPE
encode, which dominate. The median verdict is low. Not in the registry (v2-M1
covers transcript clones, v2-M2 the marker short-circuit).

**Fix.** Build the kept list in O(M): push rows while scanning forward, or
scan newest-to-oldest into a temporary and `reverse()` once at the end
(measured 0.05 ms vs 1.18 ms at N=5000). A forward loop with a precomputed
`allBefore` boundary removes the unshift while preserving the exact ordering
and `msReseted` semantics.

## L6 — Logit biases are assembled into `state.biases` and shipped on the prompt SSE event but never dispatched to any provider

- Severity: low · Category: stab · Area: server
- Finder: `hostile-send-server`, claimed medium, confidence high
- Verification: confirmed 3-0, calibrated medium→low (median low)
- Novelty: new
- Location: `prompt/assemble.ts:1195-1202` (`fillHistoryAndBias` builds
  `state.biases`) and `:1727-1728` (returned as `biases` on `AssembleResult` /
  `prompt`); dispatch ignores it: `chatDispatch.ts:41-46` (`ChatDispatchArgs`
  has no `biases` field) and `:678-1054` (no `resolveXRequest` receives bias);
  default dispatch wiring `routes/generationChat.ts:958-964`; SPA reference
  `src/ts/process/request/openAI/requests.ts:234-249,464-470` applies
  `biasString` → `logit_bias`.

**What.** Assembly faithfully merges `db.bias ∪ currentChar.bias`, unescapes
`\n`/`\r`/`\\`, variable-expands each key, and exposes them as `result.biases`
/ `prompt.biases` (also on the SSE prompt event). The route's default
`dispatchProvider` (`generationChat.ts:958-964`) calls
`dispatchChatProvider({ database, formated, outputTokens, signal })` — it never
forwards `result.biases`. `ChatDispatchArgs` has no biases field and none of
the provider arms reference `bias`/`logit_bias`; the OpenAI adapter
(`generation/openai.ts`) has no `logit_bias` in its request type or
`buildPayload`. A repo-wide grep for `logit_bias` in `server/fastify/src`
returns ZERO hits. The client also drops it: `index.svelte.ts` captures
`biases` but consumes it only in the local `dispatchRequest` else-branch,
which is unreachable on the live server-dispatch path
(`resolveServerPromptAssembly` returns only `'server'` or `'unsupported'`,
never `'local'`). In the legacy browser path the OpenAI request applied
`biasString` → `body.logit_bias`; on the live server send path it is dropped
on every dispatch.

**Impact / trigger.** Any user who configures a logit bias or banned word
(global `db.bias` via BotSettings, or per-character `char.bias` via CharConfig)
gets it applied in the old browser path but silently ignored on every
server-dispatched send — the model can emit tokens the user explicitly biased
against/for. No error surfaced. Bounded to opt-in bias configurations (default
`[]`) and to providers that supported `logit_bias`. Does not scale with
corpus.

**Verifier notes.** All three lenses calibrated medium→low: a silent
functional-parity gap on an opt-in feature, no crash/hang/loss/growth, no
scaling. Scope sharpenings: the legacy SPA applied bias on MORE than OpenAI —
`request.ts:592-665` (`logit_bias_exp`) and `:1101-1133` consumed
`biasString` too, so the legacy parity surface was broader. But on the *server*
dispatch path the realistic blast radius is OpenAI-compatible providers only:
NovelAI has no dispatch arm and dead-ends (`chatDispatch.ts:1053` "provider not
implemented yet: novelai"), and the plugin `biasString` consumer is Plugin V2
(permanently unsupported). Genuinely new (registry grep for bias/logit = 0).

**Fix.** Thread biases into dispatch: add `biases?: [string, number][]` to
`ChatDispatchArgs`, pass `context.result.biases` from the default dispatcher,
and in the OpenAI/OpenAI-compatible arms tokenize+apply them to `logit_bias`
exactly as `requests.ts:234-249` does (the server already has a tiktoken
tokenizer in `prompt/tokens.ts`). At minimum, if server bias support is
deliberately deferred, assembly should not advertise biases it cannot honor —
document the gap.

## L7 — Lorebook `useRegex` keys and customscript `in` patterns run unbudgeted on the server assembly path (extension of v3-L9)

- Severity: low · Category: stab · Area: server
- Finder: `input-bounds-server`, claimed medium, confidence medium,
  `known_overlap: v3-L9`
- Verification: confirmed 3-0, calibrated medium→low (one liveness lens
  held medium; median low to match the v3-L9 class disposition)
- Novelty: extension of v3-L9
- Location: `prompt/lorebook.ts:339-359` (`getCompiledLoreKeyRegex`),
  `:391-404` (`searchMatch` `r.test(m.data)`); `prompt/scripts.ts:308-315`
  (`new RegExp(script.in, flag)` in `prepareOne`), `:361/:376/:389`
  (`reg.test(data)` / `data.replace(reg, outScript)` in `applyOne`).

**What.** Lorebook entries imported via Realm/charx/.risu carry `useRegex`
keys; during prompt assembly `searchMatch` compiles each key as
`/pattern/flags` (`getCompiledLoreKeyRegex`) and runs `r.test(m.data)` against
the lowercased message corpus for every searchable message, every activation
pass. Separately, character/module/preset `customscript` entries carry an `in`
field compiled as `new RegExp(script.in, flag)` (`prepareOne`) and applied
with `reg.test(data)` / `data.replace(reg, outScript)` per message. Both
fields are attacker-controlled (third-party card/preset/module content), and
neither is wrapped in any per-match time budget or worker isolation. A
catastrophic-backtracking pattern (e.g. `(a+)+$`) against a moderately long
message blocks the Node event loop for seconds-to-forever. v3-L9 identified
exactly this class but its scope is anchored EXCLUSIVELY at
`triggerDataEffects.ts` (`v2RegexTest`/`v2ReplaceString`/`v2QuickSearchChat`/
`v2ExtractRegex`) + `triggers.ts` `evaluateConditions`; it does NOT touch
`lorebook.ts` or `scripts.ts`. These are two distinct, un-budgeted user-RegExp
surfaces on the routine send path. The mechanism lens sharpened the
customscript surface: `applyOne` runs per windowed history message via
`processScript('editprocess')` (`history.ts:308`) AND at submit-time via
`processScript('editinput')` (`assemble.ts:879`) and `'editoutput'`
(`assemble.ts:1805`), so the customscript hazard fires per-message, not once.

**Impact / trigger.** Import a malicious card (lorebook regex key or
customscript regex) and send a single chat message → the server event loop
hangs; all requests stall and the single-user UI freezes. The liveness lens
corrected the trigger framing: it is not a from-nothing routine action — it
requires first importing third-party content carrying the pattern, then
sending. Pattern-dependent scaling. A synchronous `regex.test` cannot be
interrupted by the request `AbortSignal`. The fillLorebookSlots path runs
unconditionally per assembly (NOT behind `enableLorebookStubs`, which only
governs lazy hydration).

**Verifier notes.** Empirically confirmed: `new
RegExp('^(a+)+$').test('a'.repeat(40) + '!')` blocked Node >30 s on a single
41-char haystack, proving full event-loop hang. No ReDoS/length/complexity
screen exists anywhere in `server/fastify/src`, and no `re2`/`safe-regex`
dependency is installed. The severity and mechanism lenses calibrated to low to
match v3-L9's own L-class disposition: identical mechanism, same trust boundary
(imported card/preset/module), same trigger (routine send after import), same
recovery (remove the card / restart). One lens noted that even L9's planned
remediation is a between-effect wall-clock budget that cannot interrupt a
single mid-backtracking regex anyway.

**Fix.** Route the lorebook `searchMatch` regex path and the scripts
`applyOne` regex path through whatever bounded-user-RegExp helper the v3-L9
trigger remediation lands — a pattern/haystack length cap + complexity screen
— rather than leaving the budget scoped only to the trigger interpreter. The
main doc recommends making the v3 Phase-5 slice a tree-wide bounded-regex sweep
rather than an enumerated-site fix.

## L8 — `idx_messages_chat_seq` exactly duplicates the messages PRIMARY KEY autoindex

- Severity: low · Category: perf · Area: server
- Finder: `sqlite-schema`, claimed medium, confidence high
- Verification: confirmed 3-0, calibrated medium→low (median low)
- Novelty: new
- Location: `messageStore.ts:82-86` (`createMessageTable`: `PRIMARY KEY
  (chat_id, seq)` then `CREATE INDEX idx_messages_chat_seq ON messages
  (chat_id, seq)`).

**What.** The `messages` table declares `PRIMARY KEY (chat_id, seq)`, which
SQLite materializes as `sqlite_autoindex_messages_1 (chat_id, seq)` because the
table is ordinary (rowid, not `WITHOUT ROWID`). Line 85 then creates
`idx_messages_chat_seq ON messages (chat_id, seq)` — byte-identical key
columns. Verified via `EXPLAIN QUERY PLAN` on `node:sqlite` (the live driver):
every read the explicit index serves (`SELECT ... WHERE chat_id=? AND
alternate=0 ORDER BY seq`, `MAX(seq) WHERE chat_id=?`, the grouped `ORDER BY
chat_id, seq` scan, the `applyChatMessageDiff` `DELETE ... seq>=?`) falls back
to the PK autoindex with an identical SEARCH/SCAN access shape when the
explicit index is dropped — it contributes zero selectivity or ordering. The
cost is pure write amplification: every INSERT/UPDATE/DELETE on `messages`
maintains two identical b-trees instead of one. (Keep `idx_messages_uid`,
which is non-redundant: the uid lookups have no `chat_id` prefix.)

**Impact / trigger.** `messages` is the highest-churn table: a row is inserted
on every user-message append, every generation finalization, every regenerate;
edits via `updateActiveMessageById` rewrite one row, while delete/truncate/
replace go through the `applyChatMessageDiff` DELETE-tail + reinsert. Each
write does extra index-maintenance I/O and WAL bytes.

**Verifier notes.** All three lenses confirmed the redundancy empirically on
`node:sqlite` (Node 24.15) and calibrated medium→low. The finder's "TWO
identical b-trees, ~2× the index-maintenance I/O" overstates it: the table is
ordinary, so each write maintains 4 b-trees (main rowid table + PK autoindex +
the redundant index + `idx_messages_uid`) — the redundant index is ONE extra
of four, ~+33% extra maintenance per write, not a doubling of total write cost.
The overhead is a fixed ~1.4 µs/row, measured ~25% slower per INSERT in
isolation but sub-microsecond-to-microsecond in absolute terms; under
WAL+`synchronous=NORMAL` there is no per-write fsync, so the cost is in-memory
b-tree CPU + a few extra WAL pages. It does NOT scale with corpus — it is
strictly per-row-written, scaling only with message write frequency. The
finder's "edits rewrite the tail" claim is overstated: the common single-message
content edit is `updateActiveMessageById` (one-row UPDATE), and a worst-case
tail rewrite of a 400-message chat added only ~0.3 ms. Not in the registry
(the only write-amp item is v2-I3 on the different `command_events` table, a
legitimate non-redundant index).

**Fix.** Drop `idx_messages_chat_seq`; the PRIMARY KEY autoindex already serves
every query. One-line change in `createMessageTable` — remove the `CREATE INDEX
idx_messages_chat_seq` statement. No query changes needed; EXPLAIN already
prefers the identical autoindex when the explicit one is absent.

## L9 — Auth `__password`/known-keys files written with non-atomic truncating `writeFileSync`

- Severity: low · Category: stab · Area: server
- Finder: `disk-file-lifecycle`, claimed low, confidence medium
- Verification: confirmed (lone skeptic), severity held low; verifier
  REFUTED the open-access framing
- Novelty: new (sibling of v2-L26)
- Location: `auth.ts:68` (`setPassword` → `fs.writeFileSync(passwordPath)`),
  `:72` (`persistKnownKeys` → `fs.writeFileSync(knownKeysPath)`); contrast the
  atomic+fsync pattern at `routes/legacyStorage.ts:76-95`
  (`writeLegacyStorageFileAtomic`, added for v2-L26).

**What.** `setPassword` and `persistKnownKeys` overwrite `data/__password` and
`data/__known_public_key_hashes.json` in place via `fs.writeFileSync` (default
flag `'w'` truncates then writes; no fsync, no rename-from-temp). v2-L26
hardened the legacy `/storage` write path with `writeLegacyStorageFileAtomic`
(write `.tmp` with flag `'wx'`, fsync the file, rename, fsync the dir), but the
auth state files were not given the same treatment. `persistKnownKeys` runs on
every successful login. The finder claimed a torn `__password` write makes the
"auth gate effectively disabled" / "auth posture changes to unprotected"; the
skeptic REFUTED that open-access framing. A torn/empty `__password` does NOT
open access and does NOT crash: (1) `createAuthState` reads an empty file to
`''` with no throw; (2) the route gate `requireAuth` (`http.ts:17`) returns 401
"Auth required" whenever `hasPassword` is false, so all data routes are DENIED,
not opened; (3) the actual consequence is recovery mode — `/auth/status`
returns `{noPassword:true}`, the client maps it to `'unset'` and prompts the
user to set a NEW password via `/auth/setup` (whose `hasPassword` guard is now
false, so it accepts a fresh password). On a LAN that is a window where whoever
reaches the port can claim the new password — but it is re-setup/recovery, not
a silent open door. The known-keys claim is accurate: a torn JSON is caught and
silently reset, forcing all clients to re-login.

**Impact / trigger.** Crash/power-loss/ENOSPC during a file write corrupts an
auth state file. Known-keys corruption (frequent — every login) → all clients
must re-login (bounded annoyance). `__password` corruption (rare — one-time
setup) → the server drops into re-setup/recovery on next boot (with the LAN
re-claim window). For single-user self-host the dangerous case is unlikely, but
it is a real durability asymmetry against an already-hardened sibling path.

**Verifier notes.** The skeptic verified the truncate-on-open window
(`size=0` immediately after `open('w')`) and confirmed `requireAuth` denies on
no-password. Below medium because there is no crash, no data-loss, and no
silent open-access; recovery is re-setup plus all-clients-relogin. Only v2-L26
is related (the sibling `/storage` path was hardened; the auth files were left
unhardened).

**Fix.** Reuse `writeLegacyStorageFileAtomic`'s pattern (or factor it into a
shared helper): write to a sibling temp file, fsync, rename over the target,
fsync the directory. Apply to both `setPassword` and `persistKnownKeys`.

## L10 — Boot loads the whole message corpus for the legacy hypaV3 backfill before `listen()`

- Severity: low · Category: perf · Area: server
- Finder: `boot-startup`, claimed medium, confidence high
- Verification: confirmed 3-0, calibrated medium→low (median low)
- Novelty: new
- Location: `app.ts:127` (`backfillLegacyHypaV3MemoryRows(db,
  loadPersistedWithMessages(db, config.dataDir).database)`); `repository.ts:1132`
  (`loadPersistedWithMessages`); `messageStore.ts:512`
  (`getAllChatMessagesGrouped`); consumer `collectLegacySummaryPlans`
  (`memoryLegacyImport.ts:129`).

**What.** In `buildApp`, before `app.listen()` (index.ts's `main()` awaits
`buildApp()` then listens), `app.ts:127` calls `loadPersistedWithMessages(db,
dataDir)` and hands `.database` to `backfillLegacyHypaV3MemoryRows`.
`loadPersistedWithMessages` runs `loadPersisted` (parses every character + every
message-free chat-metadata row) and then `getAllChatMessagesGrouped`, which
executes `SELECT chat_id, json FROM messages WHERE alternate = 0 ORDER BY
chat_id, seq` over the WHOLE messages table and `JSON.parse`'s every active
message row into memory, plus `getAllChatHypaV3Grouped` over the whole
`chat_hypa_v3` table. This is fully synchronous (`DatabaseSync.all()` +
`JSON.parse`) on the main thread. The result feeds only
`collectLegacySummaryPlans`, whose actual writes (`createMemoryChunk` /
`createMemorySummary`) are guarded by `getMemoryChunk`/`getMemorySummary`
EXISTS probes, so on a converged DB the entire message load is wasted — zero
rows written. There is NO guard (one-shot migration flag, or a cheap
"has-legacy-hypa-summary" probe) skipping it. The skeptic added a sharpening:
legacy summaries are NOT deleted from `chat_hypa_v3` after backfill, so every
boot RE-COMPUTES the plans (parsing the corpus to rebuild `chunkText`) and only
then hits the EXISTS probes and writes nothing — the wasted parse+plan-build is
deterministically repeated forever, not just on the first post-upgrade boot.

**Impact / trigger.** Triggered on EVERY server start/restart (reboot, deploy,
crash-restart, the `.risu-api-restart` flow). Cost scales as O(total active
messages across all chats): every message `JSON.parse`'d and held transiently,
blocking the event loop and delaying `listen()`. Measured ~1.9 µs/active
message (≈95 ms at 50k, ≈190 ms at 100k messages) plus `loadPersisted`'s
character/collection/asset-metadata parse — real and corpus-scaling but bounded
and sub-second even for heavy corpora.

**Verifier notes.** All three lenses calibrated medium→low: the trigger is
boot/restart (infrequent — once per process lifetime), paid once before
`listen()` as startup latency, not interactive latency; no data loss, no
runtime hang, no unbounded growth. The "multi-second" estimate is plausible
only for an extreme corpus and still only at startup. `openDatabase` does only
DDL migrations (no `integrity_check`/`VACUUM`), so this is the sole
corpus-scaling cost on the boot critical path; the sibling
`ensureDbJsonImported` short-circuits cheaply via `fs.existsSync` once db.json
is renamed. Confirmed NOT already-fixed: the in-flight v3 Phase-3 memory commits
touch none of `app.ts`/`memoryLegacyImport.ts`/`repository.ts`/`messageStore.ts`.
Not in the registry (v3 memory items are runtime send-path costs; the leftover
bootstrap gate concerns the client `/bootstrap` projection request).

**Fix.** Gate the backfill so it loads the full corpus only when there is
legacy work to do. Cheapest: probe `getAllChatHypaV3Grouped` (already
O(chats-with-hypa)) for any chat carrying an embedded hypaV3 summary not yet in
`memory_summaries` before paying `getAllChatMessagesGrouped`, or persist a
one-shot "legacy hypa backfill done" marker (mirroring the migration
version-bump pattern) and skip entirely once set. Reuse the
`loadPersistedForAssembly` / `getChatMessagesGroupedByIds` scoped-read
precedent to load messages only for the specific chats that have legacy
summaries.

## L11 — v3-M2 fix residue: summaries persist `tokens: 0`, re-tokenized per send

- Severity: low · Category: perf · Area: server
- Finder: `regression-v3-wave` (C0) + `memory-subsystem-hostile` (C49),
  claimed low, confidence high, `known_overlap: v3-M2`
- Verification: confirmed (lone skeptic), severity held low
- Novelty: extension of v3-M2
- Location: `memorySummaryAdapter.ts:49` (`summarizeOnce` returns
  `tokens: 0`), `memorySummarizeJobHandler.ts:400` (`createMemorySummary` call);
  legacy import also writes `tokens: 0` (`memoryLegacyImport.ts:120`); fallback
  `prompt/assemble.ts:1354` (`createPromptMemorySummaryTokenCost`), consumed via
  `buildPromptMemoryRowsForAssembly:1336` → allocator
  `memoryBudgetAllocator.ts:97/112/135/161`.

**What.** Commit 18cc05099 (the landed v3-M2 fix, present at working HEAD)
wires a tiktoken fallback: `createPromptMemorySummaryTokenCost` returns
`summary.tokens` only when `Number.isFinite(summary.tokens) && summary.tokens >
0`, otherwise it BPE-encodes `summary.text` via `tokenize()`. This correctly
restores budget enforcement. But `summarizeOnce` and the `createMemorySummary`
call in `memorySummarizeJobHandler.ts:400` still persist `tokens: 0` for every
newly written summary, so the fallback is NOT a one-time legacy repair — it
fires for 100% of summaries on every send. The per-assembly `fallbackTokenCache`
dedupes within one send (one encode per distinct summary id), but a fresh
closure and empty cache are built per assembly, so each memory-enabled send
re-runs `getEncoder(encoding).encode()` over every candidate summary's full
text across the important/recent/similar/random allocator passes — synchronous
CPU-bound tiktoken encodes on the event loop. The skeptic framed it strictly as
an incomplete-fix consequence of 18cc05099, not an independent finding, and
corrected the v3-L15 framing (C49 called it the L15 analogue): the planner path
L15 memoized (`tokenizeHypaV3PrefixChat` → `sharedHypaV3PrefixTokenMemo`)
tokenizes transcript/prefix CHATS, not summary text — `summaryToHypaV3Ref`
carries only `chatMemos` — so this summary-text re-tokenize is a genuinely
separate workload, NOT double-counting L15.

**Impact / trigger.** Every chat send with HypaV3 memory enabled (gated on
`database.hypaV3 === true` AND `currentChar.supaMemory === true`) pays N
full-text BPE encodes, where N is the candidate-summary count. Scales with
summary corpus size (grows with transcript length / chat age). Bounded per-send
and only on the memory feature, but permanent rather than transitional because
the persist side was never updated. Pre-fix there was no tokenization at all,
so this CPU cost is new, introduced by the v3-M2 remediation that postdates the
v3 tree.

**Verifier notes.** The skeptic verified the in-flight v3-M2 work did NOT move
token measurement to persist time — `summarizeOnce`/`memorySummarizeJobHandler`
still emit `tokens: 0` — so the per-send re-tokenize is permanent. The v3-M2
fix spec anticipated this with "optionally also measure at persist"; that half
was not done.

**Fix.** Measure tokens at persist time so stored summaries carry a real count
and the fallback becomes a true legacy-only path: in `summarizeOnce` compute
`tokens` via the same `tokenize()`/`tokenizerOptionsFromDb` the assembly
fallback uses and return it instead of `0`; `createMemorySummary` already
accepts and validates a non-negative integer (`memoryRepository.ts:567`).
Existing rows still benefit from the assembly fallback during a one-time
backfill window. The main doc folds this into the v3 Phase-3 M2 row.

## L12 — Legacy-imported summaries are never selected (model filter `'legacy-hypav3'` vs `subModel`)

- Severity: low · Category: stab · Area: server
- Finder: `memory-subsystem-hostile`, claimed low, confidence high
- Verification: confirmed (lone skeptic), severity held low
- Novelty: new
- Location: `memoryLegacyImport.ts:117`
  (`model: LEGACY_HYPA_V3_SUMMARY_MODEL = 'legacy-hypav3'`);
  `memorySelectionService.ts:105/:115` (filter `summary.model ===
  input.summaryModel`); `prompt/assemble.ts:1327` (`summaryModel:
  settings.summarizationModel`, default `'subModel'`); follow-up re-enqueue
  `memoryFollowups.ts:56-85`.

**What.** `backfillLegacyHypaV3MemoryRows` (run at boot and on full DB import
via `replaceLegacyHypaV3MemoryRowsInTransaction`) writes summaries with
`model='legacy-hypav3'` and chunk status `'summarized'`. But
`resolveSelectionSummaries` and `listMemorySummaries` filter by `model ===
settings.summarizationModel`, which is always `'subModel'`
(`resolveMemorySummaryModel` hard-rejects anything else). So legacy summaries
are stored but invisible to selection. `listMemoryChunks` does NOT filter by
model, so the legacy `'summarized'` chunk IS loaded;
`buildRepositoryDiagnostics` derives `summaryChunkIds` from the FILTERED
(legacy-excluded) summaries, so the legacy chunk falls into
`chunkIdsMissingSummaries`. The skeptic corrected the finder's single-path
framing — re-summarization is driven by TWO independent paths: (1)
`planPromptMemoryChunksForAssembly` feeds the planner only summaries filtered to
`'subModel'`, so a freshly-migrated chat presents ZERO summarized prefix and
the planner re-chunks the entire legacy-covered history, enqueuing fresh
summarize jobs under new non-colliding chunk IDs; and (2) the orphaned legacy
chunk also lands in `chunkIdsMissingSummaries` and triggers
`enqueuePromptMemoryFollowUps`. Either path causes the re-summarize round-trip.

**Impact / trigger.** Triggered once per migrated chat on the first memory send
after a v3→v4 upgrade or a risusave import containing `hypaV3Data`.
User-visible: previously-summarized long-term memory temporarily absent from the
prompt, and importance/category/tag metadata permanently lost after
re-summarization (the followup payload sets `chatMemos` to just
`[chunk.messageId]`, the last memo, and the new summary inherits none of the
legacy `isImportant`/`categoryId`/`tags`). Scales with the number of legacy
summaries. Self-heals after re-summarization (rate-limited at the default 20
summarize req/min), so low; the most durable harm is the lost metadata.
Confined to the opt-in HypaV3 memory subsystem behind a one-time migration /
import.

**Verifier notes.** The skeptic verified `memoryLegacyImport.test.ts` asserts
the legacy model is written but never asserts selectability, so no guard exists.
Distinct from v3-M2 (token budget), v3-L15 (prefix re-tokenize), v3-L16 (abort
arming), v3-K1 (embedding decode) — none describe the legacy-model selection
mismatch.

**Fix.** Either persist legacy summaries under the same model key selection
uses, or have selection consider both the active `summarizationModel` and
`LEGACY_HYPA_V3_SUMMARY_MODEL` (union), and carry `isImportant`/`tags` into job
summary metadata so re-summarization preserves them. At minimum, route the
legacy summary text into the new summary row rather than forcing a provider
round-trip.

## L13 — Legacy backfill `Math.min(...spread)` throws `RangeError` on a large non-deduped `chatMemos`

- Severity: low · Category: stab · Area: server
- Finder: `import-export-hostile`, claimed low, confidence high
- Verification: confirmed (lone skeptic), severity held low
- Novelty: new
- Location: `memoryLegacyImport.ts:160-162` (`collectLegacySummaryPlans`,
  `Math.min(...resolvedSeqs)` / `Math.max(...resolvedSeqs)`); reached on every
  import via `routes/save.ts:421` (`applyImportedDatabase` → `applyImport`
  `beforeRevision` → `replaceLegacyHypaV3MemoryRowsInTransaction`), and at boot
  via `app.ts:127`.

**What.** `collectLegacySummaryPlans` builds `resolvedSeqs` from a summary's
`chatMemos` resolved against `messageSeqById`, then computes
`Math.min(...resolvedSeqs)` / `Math.max(...resolvedSeqs)`. The spread throws
`RangeError: Maximum call stack size exceeded` once the array exceeds the
runtime's argument-count ceiling. `resolvedSeqs.length` equals the number of
NON-deduplicated `chatMemos` entries on a SINGLE summary that resolve to a
message (`messageSeqById` is a Map so messages dedupe, but `chatMemos` is not
deduped before `.map`). A `RangeError` is not a `ValidationError`, so
`save.ts`'s catch (which maps only `ValidationError` → 400) re-throws → HTTP
500; the transaction rolls back cleanly (no corruption).

**Impact / trigger.** Importing a pathological/hostile `.risu` (or restoring a
bundle) whose legacy summaries reference enough message memos in one chat aborts
the import with an opaque 500. No data loss (rollback). Import-controlled input;
very rare at default corpus sizes. The skeptic added a SECOND, more severe live
path the finder missed: `app.ts:127` calls `backfillLegacyHypaV3MemoryRows`
UNGUARDED during `createApp` on EVERY boot, reading `hypaV3Data` rehydrated from
the `hypa_v3` SQLite table — a persisted poisoned summary therefore crashes the
server on startup permanently (not just a recoverable 500), until the data is
removed.

**Verifier notes.** The skeptic empirically pinned the threshold on this
runtime (Node v24.15.0): `Math.min(...arr)` is OK at 125000 elements and throws
at 130000 (reproduced with the exact `chatMemos`→`map(Map.get)`→`filter`→
`Math.min` shape), so the practical ceiling is ~126k-130k (the candidate's
"~125k-200k" was loose). Organic trigger is effectively impossible:
`maxChatsPerSummary` defaults to 6, so each summary covers ~6 messages; reaching
130k requires a crafted/hostile summary or the bulk-resummary feature
(`HypaV3Modal.svelte:242-256` merges all selected summaries' memos, deduped,
into one) applied to a 130k+-message chat. Confirmed NOT already-fixed (the file
is untouched by the in-flight Phase-3 commits). Not in the registry.

**Fix.** Replace the spreads with non-spread reductions, e.g.
`resolvedSeqs.reduce((a,b)=>Math.min(a,b), Infinity)` and the `Math.max`
equivalent (or track min/max in the existing `.map`/`.filter` loop). This
removes the argument-count ceiling entirely with no behavior change for
normal-sized arrays. Additionally wrap the unguarded `app.ts:127` startup
backfill in a try/catch that logs and skips rather than aborting boot.

## L14 — charx asset cleanup asymmetry vs the JSON-card path

- Severity: low · Category: stab · Area: server
- Finder: `disk-file-lifecycle` (C20) + `import-export-hostile` (C54),
  claimed low, confidence high/medium, `known_overlap: v2-L24`
- Verification: confirmed (lone skeptic), severity held low; verifier
  corrected the live trigger
- Novelty: extension of v2-L24
- Location: `routes/realmImport.ts:579-607` (`importRealmCharx`:
  `saveStagedCharxAssets` commits, then unguarded
  `convertRealmCharacterCard`/`appendRealmCharacter`) vs `:334-356` (JSON path
  wraps `appendRealmCharacter` in try/catch → `cleanupCreatedAssetResults`).

**What.** `importRealmCharx` calls `saveStagedCharxAssets` — which writes asset
bytes to `data/assets/`, COMMITs the asset-table rows in its own `BEGIN
IMMEDIATE`/`COMMIT`, and emits `assetCreated` — then proceeds to
`convertRealmCharacterCard` and `appendRealmCharacter` with NO try/catch and NO
cleanup. The JSON-card sibling (`importRealmJsonCard`) wraps
`appendRealmCharacter` and calls `cleanupCreatedAssetResults` (deletes the
metadata rows + files) on failure; the charx path has no equivalent. The
skeptic corrected the trigger: the finder's headline duplicate-id re-import is
essentially DEAD for charx, because `convertRealmCharacterCard` always mints a
fresh `chaId: randomUUID()`, so `characterRowExists` never collides on a normal
re-import. The LIVE post-commit throw sites are instead (1)
`convertRealmCharacterCard` itself throwing `Embedded card asset not found` when
a `card.data.assets` `__asset:`/`embeded://` ref has no matching staged key —
which runs AFTER `saveStagedCharxAssets` has already committed the package
assets; and (2) `appendRealmCharacter` → `createCharacterRecord` →
`validateCharacterAssetRefs` → `validateServerAssetId` throwing "references a
missing server asset" for any unsatisfied image/emotion/additionalAssets/
ccAssets/vits/gptSoVits ref. Both are reachable with a hostile/malformed charx
(imported third-party content = a real vector), and both leak the
already-committed package assets.

**Impact / trigger.** After a failed charx import, the imported asset bytes and
metadata rows persist unreferenced. The skeptic confirmed the GC-reclaim claim:
`runAssetGc` treats the orphans as unreferenced and deletes metadata+file once
file mtime exceeds `ASSET_GC_GRACE_MS` (1h), swept every `ASSET_GC_INTERVAL_MS`
(15min), armed by default in `app.ts:186-197` (only disabled by the test-only
`assetGc:false`). So this is a delayed, self-healing cleanup inconsistency, not
unbounded growth — low is correct. The temp staging dir IS cleaned by
`runRealmImport`'s finally; this is committed-asset leakage, not staging
leakage.

**Verifier notes.** This is the charx half of v2-L24, whose fix slice was scoped
to the JSON-card path only — it claims the invariant "Character append failure
leaves no newly-persisted orphan assets" yet only implemented it for JSON,
leaving the charx anchor unremediated. The registry's "L24 fixed" disposition is
provably incomplete for charx.

**Fix.** Mirror `importRealmJsonCard`: capture the `AddAssetResult[]` from
`saveStagedCharxAssets` (extend it to return the created results the way
`addAssets` does — it already tracks `createdAssets`/`createdFiles` internally)
and wrap `convertRealmCharacterCard` + `appendRealmCharacter` in a try/catch
that calls `cleanupCreatedAssetResults` on failure.

## L15 — `/import/bundle` flushes assets to SQLite+disk before decoding the inner DB

- Severity: low · Category: stab · Area: server
- Finder: `import-export-hostile`, claimed low, confidence high,
  `known_overlap: v2-L24`
- Verification: confirmed (lone skeptic), severity held low
- Novelty: extension of v2-L24
- Location: `routes/save.ts:148-204` (`/import/bundle`); `localBackupImport.ts`
  `AssetBatcher` (`:119` `add`, `:223` end-of-stream `flush`), the
  `registerAssets` callback → `repository.addAssets` commits per batch, BEFORE
  `decodeRisuSaveImportSnapshot(decoded.databaseBytes)` at `save.ts:167`.

**What.** `decodeLocalBackup` (`decodeBundleZip`) registers asset batches via
the `registerAssets` callback as the zip streams; that callback calls
`addAssets`, which opens its own `BEGIN IMMEDIATE` and COMMITs each batch
immediately (`fs.writeFileSync` + insert + commit). Only after the full stream
is consumed does the route decode the inner `database.risu` via
`decodeRisuSaveImportSnapshot`, which can throw (`ValidationError` /
oversized-cap). At that point all asset batches are already committed (metadata
rows + files on disk); the route's catch returns 400 and the finally removes
only the temp upload dir — it never rolls back the committed assets. The skeptic
sharpened the timing: `AssetBatcher.add` only invokes `registerAssets` mid-stream
once a batch reaches 48 MiB (`DEFAULT_ASSET_BATCH_BYTES`); for a small bundle
(<48 MiB of assets) the single `batcher.flush()` at end-of-stream still fires
BEFORE the inner-DB decode, so the orphaning holds regardless of size — it is
not gated on archive entry ordering. The inner-DB decode has more failure modes
than "corrupt/oversized": `importSnapshot.ts` has ~15 `ValidationError` throw
sites plus the 1 GiB `bundleInnerRisuMaxExpandedBytes` expanded cap.

**Impact / trigger.** A failed bundle import (corrupt/oversized/malformed inner
`database.risu`) leaves every decoded asset committed as orphaned bytes +
metadata, plus a spurious `asset.created` event + revision bump on the failed
import. Bounded and GC-reclaimable: `runAssetGc` reference-counts orphans and
deletes them past the 60-min grace, armed by default and swept every 15 min.
Trigger: importing a malformed `.risu.zip`; rare manual opt-in action. Scales
with bundle asset count/size.

**Verifier notes.** Same orphaned-asset-on-failed-import class as v2-L24 (which
fixed the realm path) but in the distinct, previously-uncovered bundle route —
extension, not duplicate. The realm path's `cleanupCreatedAssetResults` is the
in-repo precedent the bundle path lacks; `save.ts` imports `addAssets` but never
any cleanup/delete.

**Fix.** Either defer asset registration until after the inner `database.risu`
has been successfully decoded (decode-then-register), or track the created asset
ids from each `addAssets` result and run a `cleanupCreatedAssetResults`-style
rollback in the route's catch (reuse the realm helper pattern).

## L16 — Proxy `/fetch` redirect re-sends custom auth headers cross-origin

- Severity: low · Category: stab · Area: server
- Finder: `proxy-hub-streamjobs`, claimed medium, confidence medium
- Verification: confirmed 2-1, calibrated medium→low (one liveness lens
  dissented/refuted; mechanism held medium, severity calibrated low)
- Novelty: new
- Location: `routes/proxy.ts:64-69` (`fetch(url, {method, headers, body,
  signal})` — no `redirect` option ⇒ `'follow'`); headers from
  `normalizeForwardHeaders` (`:85-101`); contrast `routes/hub.ts:137-141`
  (`redirect: 'manual'`).

**What.** The `/fetch` route calls `fetch` with no `redirect` option, so undici
follows 3xx automatically. On a cross-origin redirect undici strips
`authorization`, `cookie`, and `proxy-authorization` per the fetch spec, but
does NOT strip custom credential headers; `STRIP_REQUEST_HEADERS` (`host`,
`connection`, `content-length`, `risu-*`) likewise does not cover them, so the
client-supplied `x-api-key` (Anthropic), `api-key` (Azure), and `x-goog-api-key`
(Google) all reach undici and survive the hop. So a 30x response from the
configured endpoint redirects the request — and its credential header — to the
`Location` origin. The hub route deliberately uses `redirect: 'manual'`,
confirming the asymmetry.

**Impact / trigger.** A compromised, typosquatted, MITM'd (plain-http), or
malicious community OpenAI-compatible endpoint the user pasted can return a
redirect to an attacker origin and silently harvest the user's provider key.
Trigger: any non-streaming request whose configured upstream returns a redirect
(third-party "proxied model output", an in-scope hostile vector). Single
occurrence leaks the key; no scaling factor.

**Verifier notes.** The undici sub-claim was empirically verified on Node
v24.15.0 (the bundled undici 7.24.4): two local origins, A 302→cross-origin B; B
received `x-api-key`/`api-key`/`x-goog-api-key` and an arbitrary custom header
intact while `authorization`/`cookie`/`proxy-authorization` were stripped (307
behaved identically). The liveness lens DISSENTED/refuted the leak as scoped to
`routes/proxy.ts` on the live runtime: every completion routes server-side
(`resolveServerCompletionRoute` returns `'server'`; the client `requestClaude`
x-api-key path is dead), and the live client `globalFetch`→proxy callers with
user-configurable endpoints (`tts.ts`, `translator.ts`, `ollama.ts`, embedding
paths) use `Authorization: Bearer`/`DeepL-Auth-Key` — which undici DOES strip
cross-origin; the only live client `x-api-key` senders go to fixed hosts. That
lens noted the genuinely-live analog lives server-side in
`server/fastify/src/generation/anthropic.ts:138` (`fetch` with no redirect
option, `x-api-key: req.apiKey`, user-configurable `baseUrl`), a different
location C56 does not name. The severity lens kept it low: not a routine action
(needs a hostile/compromised endpoint), the most common community-URL vector
(OpenAI-compatible `Authorization: Bearer`) is already stripped, and the
client→proxy x-api-key path is reachable only via secondary/opt-in LLM features,
not the primary send; damage is bounded to one rotatable key, no scaling. Not in
the registry (v3-K2 is a different proxy/hub auth item, DONE).

**Fix.** Use `redirect: 'manual'` (or `'error'`) on the `/fetch` upstream fetch
and surface the 3xx to the client without auto-following, matching the hub
route. API calls should not redirect, so `redirect: 'error'` is the minimal safe
change. If following is desired, re-validate/strip credential headers before the
second hop. Consider extending the fix to the server-side generation adapters
the liveness lens flagged.
