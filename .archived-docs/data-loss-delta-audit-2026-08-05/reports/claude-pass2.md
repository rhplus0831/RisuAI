# DL2 Pass 2 report — claude

Scope: charter "Pass 2 — Script-originated durable writes", delta
`28eb3fb66..e1ac763da`, audited at HEAD (`e1ac763da`).

## Checks

- **Durable Lua character/lore writes (`492f99e9e`)** — FINDING DL2-P2-1,
  FINDING DL2-P2-2. The plumbing itself honors the invariants: both persist
  sites route through `applyTargetedCommandMutation` (`BEGIN IMMEDIATE`,
  synchronous `mutate` callback, in-transaction re-read via
  `loadPersistedForChatMutation` — `server/fastify/src/commands/mutations.ts:216-278`),
  the mutate bodies at `server/fastify/src/routes/generationChat.ts:1456-1548`
  and `:2839-2955` contain no `await`, fresh-value checks re-validate against
  the re-read state (`generationChat.ts:2731-2775`), `writeSingleChatRowExact`
  preserves unrelated chat fields (`server/fastify/src/repository.ts:671-691`),
  and preview modes never persist (`generationChat.ts:1341-1343`,
  `streamAssembly` gates on `isPersistingMode`). The findings are about what
  happens when those fresh-value/validation checks FAIL: the whole finalization
  — including the generated assistant message — rolls back, and on the inline
  path that loss is silent.
- **Persisted `@@inject` rewrites + stable-card re-expansion (`b193042e0`)** —
  SAFE. Inject rewrites are identity-addressed `replace_by_id` mutations with a
  deep-equal staleness check against the live row inside the transaction
  (`generationChat.ts:1492-1514`: `isDeepStrictEqual(location.message,
  mutation.before)` → `ValidationError` on mismatch), so a concurrent edit
  aborts the persist loudly (error frame from `streamAssembly`'s catch at
  `generationChat.ts:2400-2405`) instead of being clobbered; nothing durable is
  written on failure (single-transaction rollback). Stable-card preflight var
  writes are speculative in-memory only (snapshot + rollback + replay-once,
  `server/fastify/src/prompt/assemble.ts:892-922`) and reach disk solely
  through the same guarded chat-var persist. Preview stays read-only. Residual
  exposure: an inject whose target row is not in `initialMessages` escalates to
  the full-transcript replacement path (`assemble.ts:1815-1831`,
  `historyInjectRequiresTranscriptReplacement`) — see DL2-P2-F2.
- **Script message-index preservation (`5f4109fee`)** — SAFE. The commit is
  index plumbing (real appended-row index instead of `-1` for `editinput`
  Lua/CBS, `chatID` propagation into CBS expansion —
  `assemble.ts:1146-1188`, `server/fastify/src/prompt/scripts.ts`,
  `server/fastify/src/prompt/variables.ts:30-35`). All indexes resolve against
  the request-local transcript snapshot, so concurrent durable mutations cannot
  displace them mid-request; persistence of any resulting rewrite goes through
  the id-checked targeted-inject path or the (pre-delta) replacement path.
- **IGP sequencing after server terminal derived text (`400183698`)** — SAFE.
  The IGP target is latched synchronously at terminal-apply time with the exact
  derived text (`src/ts/process/serverBackedSendChat.ts:860-895`), re-verified
  after the IGP LLM call (`src/ts/process/postGeneration/igp.ts:48-87`:
  snapshot requires `message.data === expectedData`, else silent discard), and
  the durable command carries `expectedData`/`expectedChatId`/
  `expectedGenerationId` preconditions enforced inside the server transaction
  (`server/fastify/src/routes/commands.ts:6820-6826` → `ValidationError`, no
  write). Failure direction is always "discard the IGP suffix", never
  "overwrite a newer edit"; double execution self-cancels because the first
  append invalidates `expectedData`. Terminal/projection writes use
  `withTrustedResourceWrite` with in-wrap re-reads
  (`serverBackedSendChat.ts:683-726`, `:744-760`, `:784-803`).
- **Lorebook prompt-injection restore (`a4c00c5cb`)** — SAFE, read-only
  confirmed. `createPositionParser` is a pure closure over the activation
  report doing string surgery on template cards
  (`server/fastify/src/prompt/lorebook.ts`, `templates.ts`,
  `preflight.ts`); no repository/db import, no chat/character mutation in the
  changed paths.
- **History slots in input hooks (`559b61a4b`)** — SAFE, read-only confirmed.
  `src/ts/translator/historySlots.ts` renders text from message/translation/
  greeting reads only; `src/ts/process/inputHooks.ts:20-87` builds a prompt and
  calls `requestChatData` — the hook result flows back to the composer, not to
  durable rows; the DefaultChatScreen additions snapshot state and check
  residency without writing.

## Findings

### DL2-P2-1 — Lua lore upsert on a chat with legacy id-less `localLore` entries permanently blocks generation finalization (silent message loss inline)

- Severity: high / Confidence: probable (mechanism certain end-to-end; the
  precondition — id-less legacy entries in a real DB — is the one unverified
  link)
- Evidence: `upsertLocalLoreBook` keeps pre-existing entries as-is and only
  ids the upserted one (`server/fastify/src/prompt/luaRuntime.ts:1842-1858`).
  The mutation payload carries the whole array; at persist time
  `validateLocalLoreEntryIds(after)` requires EVERY entry to carry a non-empty
  id (`generationChat.ts:2746-2761`) and throws `ValidationError` otherwise.
  `ValidationError` is a *terminal* finalization error
  (`generationChat.ts:2970-2972`), so the retry sweep marks it terminal and
  never re-attempts (`:3084-3092`). No load-path repairs chat `localLore` ids:
  assembly loads via `parseStoredChatRow`, which repairs only generation
  settings (`repository.ts:1611-1615`); `repairLorebookEntries`
  (`server/fastify/src/commands/lorebooks.ts:275-289`) runs only on lorebook
  *command* routes, and the client bridge mints ids only when the scope is next
  mutated (identity-dirty contract) — a chat whose lore predates the
  2026-07-23 identity work and was never re-edited keeps id-less entries
  indefinitely. Because the message append/replace and the lore write share
  one atomic mutate (`generationChat.ts:2832-2956`), the whole thing rolls
  back.
- Loss scenario: user has a pre-identity-work chat whose `localLore` entries
  have no `id`, with a character/module Lua script that calls
  `upsertLocalLoreBook` (start/output trigger). Every send finishes streaming,
  then finalization throws `Generation local lore entry id must be a non-empty
  string` → rollback → the generated assistant message is never durably
  persisted. Durable sends at least emit an error frame
  (`generationChat.ts:3217-3229`); inline continue/regenerate swallows the
  failure entirely (`generationChat.ts:2118-2128` — metric only, "no frame")
  and the client issues no fallback persist
  (`src/ts/process/index.svelte.ts:571-576`), so the streamed text sits in the
  projection looking saved and vanishes on reload. Deterministic, repeats on
  every generation in that chat.
- Fix direction: repair/mint ids for id-less `localLore` entries at the
  finalization boundary (or a one-time load/boot backfill) instead of
  rejecting; at minimum, downgrade the id validation to repair-and-continue so
  the message persist cannot be blocked by pre-existing rows.

### DL2-P2-2 — Character-field/local-lore staleness check rolls back the whole generation result (generated message lost in a race window; silent on the inline path)

- Severity: medium / Confidence: certain
- Evidence: `applyGenerationCharacterFieldMutationsFresh` /
  `applyGenerationLocalLoreMutationFresh` throw `ValidationError` when the live
  value no longer equals the assembly/post-gen-time `before`
  (`generationChat.ts:2731-2744`, `:2763-2775`). Both run *unconditionally*
  inside the same atomic mutate that appends/replaces the assistant row
  (`:2858-2867`), unlike the pre-delta chat-var check which is gated on
  `targetSnapshot`. `ValidationError` is terminal for the durable retry queue
  (`:2970-2972`, `:3084-3092`); the inline path swallows the error with no
  frame (`:2118-2128`) and the browser never persists its optimistic copy
  (`index.svelte.ts:571-576`). The `before` values are snapshotted at
  assembly start / post-gen start (`assemble.ts:754-756`, `:2967-2970`), so
  the race window spans the entire generation, including the provider stream.
- Loss scenario: a bot's Lua script calls `setCharacterFirstMessage` (or
  `upsertLocalLoreBook`) in its output trigger; while the reply streams
  (seconds-minutes), the user edits the character's greeting (or adds a chat
  lore note) — a routine, unrelated-feeling edit. At finalization the fresh
  check trips → the entire transaction rolls back → the generated assistant
  message is durably lost. On inline continue/regenerate the user sees the
  text on screen, gets no error, and loses it on reload.
- Fix direction: on staleness, drop only the conflicting script mutation
  (persist message + non-conflicting writes, emit a warning frame), or make
  staleness retryable by re-deriving `before` from the live row instead of
  failing the whole finalization terminally.

## Free-hunt findings

### DL2-P2-F1 — Server Lua `setDescription` writes are silently non-durable (SPA persists them)

- Severity: medium / Confidence: certain
- Evidence: server host fn mutates only the request-local snapshot:
  `server/fastify/src/prompt/luaRuntime.ts:1788-1792` (`char.desc = desc`,
  nothing else). `characterFieldSnapshot` tracks only
  `name`/`firstMessage`/`backgroundHTML`
  (`assemble.ts:762-769`), so `desc` never enters
  `characterFieldMutations` and is never persisted. The SPA counterpart
  persists durably via `setCharacterByIndex`
  (`src/ts/process/scriptings.ts:732-743`). The parity finding ST-3
  (`docs/audit/docs/scripts-triggers-lua.md:11-25`) enumerated only the other
  four setters, so `492f99e9e` fixed those and left `setDescription` behind —
  an undocumented gap, and the ST-3 doc still reads "Open".
- Loss scenario: a character-management Lua script calls
  `setDescription(id, newDesc)` during a trigger; the call returns as if
  successful and same-request `getDescription` even reads the new value back —
  but nothing is persisted, no mutation/event/warning is emitted, and the next
  request reloads the old description. Script-authored character data is
  silently lost on every server generation (worked durably on the SPA).
- Fix direction: either add `desc` to the tracked character-field mutation
  set (one more key in `characterFieldSnapshot` + the mutation union), or make
  the host fn throw/warn server-unsupported instead of silently succeeding.

### DL2-P2-F2 — Delta-added full-transcript replacement triggers can silently clobber concurrent message edits made during a long assembly window

- Severity: medium / Confidence: probable (server mechanism certain; the
  unverified link is that the client permits message mutations to land while
  its own generation is assembling — e.g. an edit/delete of an older row, or a
  latency-delayed outbox write)
- Evidence: when `submitTranscriptChanged` is set with `submitMessages`
  captured, `persistAssemblyMutations` REPLACES the chat's entire active
  transcript with the assembly-time snapshot —
  `replaceActiveChatMessages(targetDb, chatId, replacement)`
  (`generationChat.ts:1479-1491`) — with id-uniqueness checks but NO per-row
  staleness check (contrast the targeted-inject path's `isDeepStrictEqual`
  guard at `:1500-1502`). `baseRevision` is read AFTER assembly
  (`:1439`), so edits that landed during assembly pass the revision check and
  are overwritten. The replacement machinery is pre-delta, but the delta added
  two new triggers routing into it: the agent-preset before-main user-input
  modifier (`assemble.ts:1512-1535`, sets `agentPresetInputTransformed` after
  awaited LLM steps — stretching the load→replace window to one or more full
  model calls) and the id-less `@@inject` target fallback
  (`assemble.ts:1815-1831`, `historyInjectRequiresTranscriptReplacement`).
  The append-only fast path does not save concurrent writes: a concurrent
  append raises `persistedLength` so `canAppendAssemblyReplacement`
  (`generationChat.ts:1356-1376`) fails and the full replace deletes the
  appended row.
- Loss scenario: user sends a message with an agent preset whose before-main
  step runs a model call; while assembly waits on that call the user edits an
  earlier message (its command settles durably); assembly then persists the
  full pre-edit transcript snapshot → the user's edit is durably reverted, no
  error anywhere — the subsequent `generationAssemblyPersisted` event refreshes
  the projection and the edit visibly vanishes.
- Fix direction: staleness-guard the replacement (compare per-row `before`
  from `initialMessages` like the inject path, or reject when
  `countChatMessages`/row hashes drifted from the assembly snapshot) and fail
  the send loudly instead of overwriting.

## Not examined

- The Gemini media-output half of `492f99e9e` (PR-5: `responseModalities`,
  inlineData → inlay markers) beyond confirming `persistServerInlayAsset`
  (`server/fastify/src/inlayAssetPersistence.ts`) is an additive, standalone
  asset write outside the guarded chat transactions. Orphaned-asset growth
  from aborted generations was not traced (Pass 5's retention/GC territory).
- Agent-preset settings storage, module lifecycle, and round-trip
  (`0522cb4cb`, `76dcd9f99`) — Pass 1/3/5 surfaces; only the before-main
  transcript-write interaction was examined here (DL2-P2-F2).
- The `request_history` writes performed by Lua `generateImage`/`similarity`
  (`3713304e4`) — the durable store itself is Pass 1/5's named suspect.
- Client UI gating of message edit/delete during an in-flight generation (the
  unverified link in DL2-P2-F2); establishing it requires driving the app.
- Exhaustive review of every pre-delta Lua chat-message host fn
  (`setChat`/`cutChat`/`removeChat`/…) for SPA persistence parity; spot-checks
  showed SPA `setChat` also mutates only engine state
  (`src/ts/process/scriptings.ts:228-236`), so unlike `setDescription` no
  parity divergence was established.
