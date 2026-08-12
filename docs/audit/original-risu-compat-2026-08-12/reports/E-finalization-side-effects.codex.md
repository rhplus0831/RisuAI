# Brief E — Finalization order & side effects (Codex track)

Audit target: current HEAD `8bf88e43c26b10697d0ecc9aaad2b0610d65cf9b` against the required fork-point worktree `/home/codex/risu-baseline-71c476e9c` (`71c476e9c`). I followed the charter's exact user-visible parity standard and excluded every item already listed in `ADJUDICATION.md` or the intentional sections of the three archived audit documents named in the brief.

## Findings

### E-1 — A second send can invalidate a queued finalization and permanently lose the first reply and all of its side effects

Severity: **high**

Current behavior:

- A confirmed journal entry whose authoritative commit fails is returned as `queued` (`server/fastify/src/routes/generationChat.ts:3616-3658`, `server/fastify/src/routes/generationChat.ts:3682-3739`). The client records that status only in the projection store (`src/ts/process/serverBackedSendChat.ts:751-763`) and then unconditionally releases the generation activity in `finally` (`src/ts/process/index.svelte.ts:672-675`). The next-send gate consults only the active generation registry/legacy busy flag, not the finalization projection store (`src/ts/process/index.svelte.ts:218-228`; `src/ts/process/generationPersistenceState.ts:25-40`, `src/ts/process/generationPersistenceState.ts:121-143`).
- The server likewise excludes `finalizing` from both its one-live-operation unique index and its admission query (`server/fastify/src/generationOperations.ts:442-444`; `server/fastify/src/routes/generationOperations.ts:352-363`). A new accepted send can therefore append its user row (`server/fastify/src/routes/generationOperations.ts:388-406`) while the previous operation's finalization is still queued.
- Replay requires the transcript to have exactly the captured length and tail (`server/fastify/src/generationFinalizationRetry.ts:511-520`; `server/fastify/src/routes/generationChat.ts:2996-3023`). The new user row makes that check fail. The retained attempt then becomes terminal instead of writing its assistant row, chat variables, character fields, local lore, or effect ledger.
- While the window is open, the user sees the provisional assistant row with “This reply is waiting to be saved and remains provisional” (`src/lib/ChatScreens/Chat.svelte:1492-1504`, `src/lib/ChatScreens/Chat.svelte:3211-3219`; `src/lang/en.ts:69-75`). That presentation does not disable another send.

Baseline behavior:

- The fork point rejects a normal second send while its single `doingChat` flag is set (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:180-187`). More importantly, it inserts/updates the assistant and runs the output trigger synchronously in the same `sendChat` invocation before completion (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1603-1616`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1689-1702`); it has no state in which a displayed reply is journaled but missing from the transcript used by the next send.

User-visible consequence and repro:

1. Inject a one-shot failure after `enqueueGenerationFinalizationRetry` succeeds but before `persistGenerationFinalizationAttempt` commits (a revision race or a fault-injected targeted-write failure suffices).
2. Wait for the first generation to return the provisional/queued terminal state, then submit another message before the five-second retry sweep.
3. The second user row is accepted. The first retry now fails its exact-length/tail fence and becomes terminal. The provisional first assistant eventually disappears or remains marked unsavable; all of its output-script chat-variable, character, lore, translation, and client-effect work is absent. At the fork point, the first assistant/output-trigger result is part of the live chat before a second normal send can proceed.

Charter classification: **candidate-fix**. A `finalizing`/replayable finalization should remain a same-chat admission fence, or the newer operation must be sequenced after the retained attempt rather than invalidating it.

Confidence: **high** in the control flow; **medium-high** in incidence because reaching the initial queued state requires a transient failure.

### E-2 — Lua `setDescription()` mutates the request clone but is absent from every durable character-field diff

Severity: **med**

Current behavior:

- The Lua API accepts `setDescription` and assigns `char.desc` on the working character (`server/fastify/src/prompt/luaRuntime.ts:1812-1820`).
- The durable mutation type permits only `name`, `firstMessage`, and `backgroundHTML` (`server/fastify/src/prompt/assemble.ts:376-380`). The snapshot has exactly those three fields (`server/fastify/src/prompt/assemble.ts:842-851`), and `buildCharacterFieldMutations` can consequently never emit `desc` (`server/fastify/src/prompt/assemble.ts:1375-1380`). Post-generation resets its durable baseline through the same incomplete snapshot (`server/fastify/src/prompt/assemble.ts:3103-3109`).
- Finalization writes only the emitted character-field mutations (`server/fastify/src/routes/generationChat.ts:3331-3334`, `server/fastify/src/routes/generationChat.ts:3405-3407`). The mutated request clone is discarded after the request.

Baseline behavior:

- Fork-point `setDescription` assigns `char.desc` and writes the character back to `DBState.db.characters[selectedChar]` (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:652-666`). Its apparent `typeof data` typo does not block an ordinary output trigger because `runScripted` defaults that outer `data` value to a string (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:52-66`).

User-visible consequence and repro:

Use a standard Lua output trigger containing `function onOutput(id) setDescription(id, "new description") end`. Current code observes the new description inside that Lua invocation, emits no character mutation, and shows the old description after hydration/reload and in later generations. The fork point retains `"new description"` in the selected character.

Charter classification: **candidate-fix**. Add `desc` to the character-field mutation contract, snapshot/diff, freshness handling, wire type, client projection, and tests.

Confidence: **high**.

### E-3 — Concurrent edits cause fork-point output-script writes to be silently dropped, including whole-array loss for unrelated local-lore changes

Severity: **med**

Current behavior:

- Each chat-variable mutation is compared to its assembly-time `before` value; a mismatch drops that key while other mutations continue (`server/fastify/src/routes/generationChat.ts:3060-3075`, `server/fastify/src/routes/generationChat.ts:3096-3122`).
- Each supported character field is handled similarly (`server/fastify/src/routes/generationChat.ts:3125-3161`).
- Local lore has a single whole-array fence. Any deep difference—even an unrelated entry added by the user—drops the entire script-produced lore result (`server/fastify/src/routes/generationChat.ts:3190-3222`).
- Finalization still commits the assistant and only the nonconflicting mutations (`server/fastify/src/routes/generationChat.ts:3327-3407`). The client receives a `stale_generation_script_mutations` warning rather than the side effect (`server/fastify/src/routes/generationChat.ts:2078-2098`).

Baseline behavior:

- At the fork point the output trigger runs after the provider response against the then-live chat (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1605-1616`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1693-1699`). `getChatVar`/`setChatVar` read and write that live scripting state (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:105-113`); character setters write the selected character (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:629-638`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:674-686`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:715-725`); local-lore upsert filters and appends against the current local-lore array (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:762-794`). There is no “drop the script write but keep the assistant” conflict outcome.

User-visible consequence and repro:

- Start a slow generation with output Lua equivalent to `$count = $count + 1`. While the provider is running, change `$count` from `1` to `5` in another active writer. Current derivation computes `2` from its request snapshot, then drops it and leaves `5`; the fork-point live output trigger observes `5` and leaves `6`.
- For lore, have the output trigger upsert entry `script-note`, then add an unrelated `user-note` during provider execution. Current code drops the full scripted lore mutation, so only `user-note` remains; the fork-point upsert retains the unrelated entry and adds/replaces `script-note`.

Charter classification: **decide**. The present policy intentionally avoids overwriting newer user edits, but it is not fork-point value parity. Per-key/per-field conflicts and the especially coarse whole-array lore fence deserve separate product decisions; a semantic per-entry lore operation could preserve both writes.

Confidence: **high**. Current integration tests explicitly pin the drop behavior in `server/fastify/__tests__/generation.chat.test.ts:4668-4811` and `server/fastify/__tests__/durableGeneration.test.ts:2624-2745`.

### E-4 — A generation-effect claim has no lease/recovery path, so a claimed durable effect can be stranded forever

Severity: **med**

Current behavior:

- `igp`, `plugin_output`, and `generated_translation` are classified durable; notification, TTS, and completion sound are ephemeral (`server/fastify/src/generationEffects.ts:7-30`).
- The browser first persists a `claimed` state, then invokes the callback, then sends the receipt (`src/ts/process/generationEffectLedger.ts:116-151`). A process exit after the claim and before the callback/receipt leaves the row `claimed`.
- Bootstrap recovery selects only `pending` client effects (`server/fastify/src/generationEffects.ts:267-279`). The claim endpoint rejects every non-pending row as already receipted (`server/fastify/src/generationEffects.ts:319-320`), and no age/lease reclamation is present. A failed receipt request also merely returns `false` (`src/ts/process/generationEffectLedger.ts:192-219`).
- Late recovery would otherwise run plugin output and then IGP (`src/ts/process/recoveredGenerationEffects.ts:81-115`), so this is a real hole in the advertised durable replay path.

Baseline behavior:

- In an uninterrupted fork-point finalization, configured IGP runs synchronously and appends its returned text to the last assistant row before stage 4 (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1726-1736`). There is no durable “claimed but neither executed nor retryable” state.

User-visible consequence and repro:

Complete a generation with IGP configured, disconnect the original viewer so a later browser performs recovery, let that browser successfully claim `igp`, and terminate it immediately before `evaluateIgp`. On every later restart the row is excluded from pending recovery and cannot be reclaimed. The assistant never receives the IGP suffix that normal fork-point finalization applies. The same window can permanently suppress `plugin_output`.

Charter classification: **candidate-fix**. Claims need an expiry/reclaim protocol or another crash-safe execution/receipt design; any reclaim must retain idempotency for callbacks that may have run just before a crash.

Confidence: **high** in the state-machine hole; **medium** in practical frequency because it requires a crash in a narrow interval. No crash-injection test was run.

### E-5 — Cancelling one Hypa batch item aborts/retries unrelated siblings and can exhaust them

Severity: **med**

Current behavior:

- `MemoryWorker.processOne` creates one `AbortController` for the entire batch and registers every claimed sibling job against that same controller (`server/fastify/src/memoryWorker.ts:206-230`). Cancelling any registered job aborts that shared controller (`server/fastify/src/memoryWorker.ts:109-113`); the DELETE route invokes it after marking the target job cancelled (`server/fastify/src/routes/memoryJobs.ts:181-200`).
- Summarize jobs all receive the shared signal (`server/fastify/src/memorySummarizeJobHandler.ts:96-123`). In ordered commit, encountering the cancelled job sets `blockedByCommitFailure`; all later siblings skip `persistSummary` and are sent to `retryOrFail` even if their provider call already succeeded (`server/fastify/src/memorySummarizeJobHandler.ts:133-158`).
- Claims increment attempt count (`server/fastify/src/memoryRepository.ts:1293-1328`), the default maximum is three (`server/fastify/src/memoryRepository.ts:8`, `server/fastify/src/memoryRepository.ts:1130-1133`), and `retryOrFail` makes an at-limit sibling permanently failed (`server/fastify/src/memoryRepository.ts:1370-1390`).

Baseline behavior:

- The fork-point normal Hypa V3 path awaits a summary for the selected chat slice and immediately pushes every successful result to stored memory (`/home/codex/risu-baseline-71c476e9c/src/ts/process/memory/hypav3.ts:1141-1161`). It has no unrelated-job shared abort that can convert another summary attempt into a failure.

User-visible consequence and repro:

Let sibling `job-2` reach attempt two through transient provider failures. On attempt three, batch it with `job-1` and cancel running `job-1` while both provider calls are abort-aware. The shared controller aborts `job-2` too; its third claimed attempt is sent through `retryOrFail` and becomes permanently failed. Subsequent prompts omit that memory slice even though the user cancelled only `job-1`. Separately, if sibling outputs are already staged (or the provider ignores the signal), the ordered commit fence can discard a later successful result and retry it; that exact staged-output case is pinned by `server/fastify/__tests__/memorySummarizeJobHandler.test.ts:665-704`. Even before exhaustion, cancellation delays siblings and can repeat charged provider work.

Charter classification: **candidate-fix**. Cancellation authority should be job-scoped; if ordered commit must block later jobs, successful staged results need a recovery mechanism that does not consume them as provider failures.

Confidence: **high**.

### E-6 — Server-finalized character/lore writes are not applied by the terminal message-patch path

Severity: **low**

Current behavior:

- The wire patch explicitly carries optional `characterFieldMutations` and `localLoreMutation` (`src/ts/process/request/serverChatEvents.ts:170-181`), and server finalization returns the mutations it actually persisted (`server/fastify/src/routes/generationChat.ts:3460-3478`).
- `applyServerMessagePatch` handles message, chat-variable, and chat-metadata mutations only (`src/ts/process/request/serverMessagePatch.ts:49-70`). The terminal path calls that incomplete applier (`src/ts/process/serverBackedSendChat.ts:840-851`). It has no reference to the live character and cannot apply either omitted category.
- A `generationPersistedWithChatState` event is broad enough to schedule a later character/chat refresh (`server/fastify/src/commands/events.ts:646-656`; `src/ts/server/resourceInvalidation.ts:595-602`), but event processing is asynchronous (`src/ts/bootstrap.ts:667-675`). The immediate terminal projection is observably stale and remains so if the event stream is delayed or reconnecting.

Baseline behavior:

- Fork-point setters immediately mutate the selected live character (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:629-638`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:674-686`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:715-725`) and local-lore upsert immediately replaces the live chat array (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:779-794`).

User-visible consequence and repro:

Delay/disconnect `/api/v1/events`, then run an output trigger that calls `setName` and `upsertLocalLoreBook`. The server durably commits both and the assistant/chat variables update in the terminal patch, but the active browser continues to show/read the old character name and old local lore until an authoritative refresh. At the fork point those values change synchronously with the output trigger.

Charter classification: **candidate-fix**. Apply character fields through the resolved live character and local lore through its resolved chat in the same trusted terminal projection, with the same target/freshness protections used for messages.

Confidence: **high** in the immediate projection gap; **medium-high** in duration because a healthy event stream normally heals it quickly.

### E-7 — Lua local-lore upsert exposes and persists UUID identity that the fork point did not create

Severity: **low**

Current behavior:

- `upsertLocalLoreBook` preserves the replaced entry's nonempty ID or generates a UUID for a new/id-less entry, then includes it in the new value (`server/fastify/src/prompt/luaRuntime.ts:1851-1885`). `getLoreBooksMain` spreads that ID into the JSON returned to Lua (`server/fastify/src/prompt/luaRuntime.ts:1888-1912`; the wrapper decodes it at `server/fastify/src/prompt/luaRuntime.ts:524-525`).
- On persistence, finalization additionally repairs every missing/duplicate ID in the full resulting local-lore array (`server/fastify/src/routes/generationChat.ts:3164-3187`, `server/fastify/src/routes/generationChat.ts:3219-3222`). That can change untouched legacy siblings as a side effect of one script upsert.

Baseline behavior:

- Fork-point upsert removes matching comments and appends a replacement with no `id` member (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:762-794`). Its getter returns the entry shape as stored (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:728-751`) and the Lua wrapper merely JSON-decodes it (`/home/codex/risu-baseline-71c476e9c/src/ts/process/scriptings.ts:1238-1240`). Replacing an existing ID-bearing entry also discards that ID.

User-visible consequence and repro:

From an empty local lore, run an output trigger that upserts comment `memo`, calls `getLoreBooks(id, "memo")`, and stores `books[1].id or "absent"` in a chat variable. Current stores a random UUID; the fork point stores `"absent"`. Exports also differ, and current may assign new IDs to unrelated id-less/duplicate legacy entries during the same finalization.

Charter classification: **candidate-keep**. Stable entry identity appears required by the server's targeted lore CRUD and conflict model, but this is a deliberate script-visible/import-export value divergence and needs maintainer sign-off under the charter.

Confidence: **high**.

## Areas swept and found clean

- Core post-generation order is preserved for the supported path: current performs editoutput (`server/fastify/src/prompt/assemble.ts:3117-3120`), assistant insertion (`server/fastify/src/prompt/assemble.ts:3126`), run-vars (`server/fastify/src/prompt/assemble.ts:3139-3144`), output trigger (`server/fastify/src/prompt/assemble.ts:3146`), and mutation capture for persistence (`server/fastify/src/prompt/assemble.ts:3148-3163`). This matches the fork point's edit/insertion followed by run-vars and output trigger (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1582-1585`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1603-1616`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1631-1686`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1693-1699`), subject to already-adjudicated Continue/editoutput behavior which is intentionally not re-reported here.
- For a fresh target, the finalization journal serializes chat-variable, supported character-field, and local-lore mutations together (`server/fastify/src/generationFinalizationRetry.ts:103-132`) and the authoritative commit writes the assistant and applied script state in one transaction (`server/fastify/src/routes/generationChat.ts:3305-3478`). I found no additional reorder or duplicate-application path beyond E-1/E-3.
- The effect ledger's late-recovery “ephemeral” classification is clean with respect to durable fork-point state: notification, TTS, and completion sound are observable one-shots, not durable data mutations (`server/fastify/src/generationEffects.ts:23-30`, `server/fastify/src/generationEffects.ts:323-333`; fork-point TTS/notification at `/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1622-1624`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1767-1781`). E-4 concerns stranded durable claims, not the ephemeral classification.
- Hypa's instance-keyed client projection and authoritative snapshot merge did not expose a stored-summary mismatch; the issue found is the backend's shared cancellation controller in E-5.
- The `67210c623` trigger/CBS change adds compatibility diagnostics and browser-context plumbing without changing the editoutput/run-var/output-trigger sequence. I found no new behavior change there after excluding already-adjudicated unsupported callbacks and V2/no-op cases.
- Previously adjudicated streaming cancellation, post-token stream failures, raw fallback after Lua failure, auto-continue, global Lua isolation, legacy memory removal, `@@emo`, stable-card CBS, screen-height/browser-only callbacks, and resolved two-pass Continue behavior were checked only to avoid duplication and are not findings in this report.

## Could not verify completely

- I did not execute destructive crash/fault injection against a live database. E-1 and E-4 are proven from their admission/state-machine predicates, but their real-world frequency was not measured.
- I did not measure the browser-visible duration of E-6 on a healthy command-event stream; direct code proves the terminal patch omission, while event invalidation normally provides asynchronous healing.
- I did not run a live paid/provider Hypa request at retry exhaustion for E-5. The shared-controller, attempt-limit, and commit paths are direct, and the existing repository test proves the sibling staged result is discarded and retried.
