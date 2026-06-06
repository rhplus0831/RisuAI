# Stability And Performance Audit V2

Date: 2026-06-05.

This is the second broad stability/performance audit of the Fastify-only RisuAI
codebase. It follows the v1 audit
(`docs/archive/audit-stability-and-performance/audit-stability-and-performance.md`,
2026-06-04) and the full remediation wave that landed since (Phases 0-8,
commits `0dc7452e`..`948ae486`, all v1 scheduled fixes `DONE` per the archived
`active-risk-analysis.md`). The app still shows performance issues in
use, so this audit re-examines the post-fix codebase: fresh gaps the v1 sweep
did not cover, residual gaps adjacent to landed fixes, and regressions
introduced by the fix wave itself.

The code is the source of truth. Every finding was located in current code and
adversarially re-verified against it. Line numbers will drift; use symbol names
as the durable anchors. IDs in this document (H/M/L/I) are v2-scoped; v1 items
are referenced as `v1-H1`, `v1-L7`, etc.

## Scope And Context

- Deployment model: single-user self-host. Crashes, data loss/corruption, UI
  hangs, and hot-path work that scales with corpus size are serious;
  multi-tenant-only concerns are not.
- Not released, no real users. DB migrations out of scope; normal-use data
  loss/corruption in scope.
- All v1 scheduled fixes are landed and were verified as still present. v1
  gated items (`v1-L4`, `v1-L7`, `v1-L26`, `v1-U2`) and `leftover.md`
  evidence gates were respected: candidates matching them were classified as
  known-item overlaps, not new findings (see
  [Known-Item Overlaps](#known-item-overlaps)).
- Tree health at audit time: both project-reference TypeScript checks pass
  (`tsc -p tsconfig.client-lib.json`; `tsc -p server/fastify/tsconfig.json
  --noEmit`).

## Method

Multi-agent audit, 250 agents total:

- Round 1: 15 parallel subsystem finders (server: generation lifecycle, prompt
  assembly, Lua/triggers, SQLite/repository, projection/events/app, memory,
  import/export/assets, providers/outbound; client: state/snapshots,
  projection bridges, send/streaming, render/parse, UI components; cross-cutting:
  fix-wave regression review, lifecycle/concurrency). Every in-scope file read
  in full; every candidate traced to a live caller.
- Every candidate was adversarially verified: high/medium claims by three
  independent lenses (liveness/reachability, existing-mitigation/novelty,
  severity calibration for single-user self-host), low claims by a single
  skeptic instructed to refute. Majority verdicts; severity is the calibrated
  median, frequently lower than the finder's claim.
- A completeness critic then identified blind spots, and a second round of 5
  finders covered them: the CBS/`risuChatParser` interpreter layer (which the
  Phase 7 memoization does NOT cover), translate/TTS/media lifecycle, the
  files/inlay/zip/PNG import pipeline, the MCP client runtime, and
  translate-on-render/i18n.

Raw counts: 131 candidates (94 round 1 + 37 round 2) → after dedup and
verification: **102 confirmed** (3 high, 22 medium, 59 low, 18 informational),
12 classified as overlaps of known v1/gated/leftover items, 13 dismissed. The
dismissed and known-overlap candidates are recorded at the end so they are not
re-opened or re-reported as new.

## Cross-Cutting Themes

Most findings are instances of seven patterns. Fix the pattern when practical.

1. **The hydrated whole-corpus mutation path is still wired to routine
   routes.** Phase 2 narrowed the hottest message/scriptstate routes, but a
   second ring was missed: chat-create runs the full
   `loadPersistedWithMessages` + `cloneJsonValue` + `syncChatMessages` path to
   insert one empty chat (H2), Realm import does the same per imported
   character (L13), single-row character/chat PATCH still does the broad
   `loadPersisted` + whole-corpus repair (M5, twice for character PATCH), and
   durable generation finalization never sets `chatScopedRead`
   (known-overlap of `v1-L6`, see below — the highest-value known-item
   residual).

2. **The CBS/`risuChatParser` interpreter layer is the largest unmitigated
   per-send server cost.** Phase 7 memoized regex scripts and modules, not the
   CBS interpreter. Per assembly the full transcript is `structuredClone`d
   ~6-12× and `JSON.stringify`d ~4-8× even when unchanged (M1), every history
   message is re-parsed through `risuChatParser` with no marker-free
   short-circuit (M2 — the guard `v1-L2` added to run-vars was never applied
   to the history walk), template content cards are CBS-expanded twice per
   send (M3), and `{{charhistory}}`-family callbacks re-parse the whole
   transcript from inside an innocuous-looking prompt section (M4). Parser
   micro-costs follow the same shape (L8-L11, I16).

3. **Client clone narrowing also has a second ring.** `pluginStorage.getItem`
   deep-clones the entire database per key read (M8), `changedChatMetadata` is
   the un-narrowed twin of the fixed `v1-M13` (M9), module commands clone the
   whole characters array for rollbacks that cannot touch it (M10), and every
   `replace_all` message patch `structuredClone`s the full transcript
   redundantly (M7).

4. **The GUI-reload remount is the central client render amplifier.** One
   `ReloadGUIPointer` bump remounts every visible message (`{#key
   chatReloadPointer}`) AND wipes `processScriptCache`/`compiledRegexCache`
   (`resetScriptCache`), so each remount re-runs the entire
   display-trigger + regex + markdown + sanitize pipeline cold, per visible
   message (H3). Auto-translate detection (M17) and the absence of a
   content-keyed `ParseMarkdown` memo (L40) multiply through the same remount.

5. **Opt-in subsystems that v1 never audited carry hard breakage.** The
   translate/TTS/MCP/file-import layers were outside every prior workstream:
   an unbounded O(n²) translate cache (M15), per-token re-translation during
   streaming because `DoingChat` only guards "exp" translators (M16), an
   `AudioContext` leaked per TTS playback (M18), a permanently poisoned
   bergamot promise chain (M19), MCP requests with no timeout at all (M20), an
   operator-precedence bug that defeats the CharX 50 MB import guard (M21),
   and a leftover 100-line test cap that silently truncates `.po` translation
   jobs (M22). Feature-gated, but they degrade or break sessions hard once
   enabled.

6. **Bridge echo-guard asymmetry.** The chat/script/settings watchers gate on
   `getServerProjectionApplyEpoch()`; the lorebook and character-profile
   watchers do not, so foreign projection edits are echoed back to the server
   as brand-new commands (M11, M12).

7. **Residual lifecycle hygiene.** Fixed-rate reconnect with no backoff (L45),
   unbounded module-level maps/sets (L36, L46, L50), per-call `new
   AudioContext`/listeners/intervals without teardown (M18, M14, I15), and
   stray full-payload `console.log`s on warm paths that Phase 7's sweep missed
   (M16, L38, L47, L52, L57).

## Findings Index

| ID | Sev | Cat | Area | Title |
| -- | --- | --- | ---- | ----- |
| H1 | High | stab | server | V2 trigger interpreter has no abort check, wall-clock budget, or hard iteration/recursion cap — a `v2Loop` or low-level recursion hangs the send forever |
| H2 | High | perf | server | Chat creation runs a whole-corpus hydrate + deep clone + full message diff to insert one empty chat |
| H3 | High | perf | client | Every variable-changing trigger pass remounts and fully re-parses ALL visible messages |
| M1 | Med | perf | server | Full chat transcript is `structuredClone`d and `JSON.stringify`d several times per assembly even when unchanged |
| M2 | Med | perf | server | History walk re-parses every message through `risuChatParser` with no marker-free short-circuit (asymmetric with the landed `v1-L2` guard) |
| M3 | Med | perf | server | `renderContentCard` runs full CBS expansion (and slot clones) twice per assembly: token preflight + real render |
| M4 | Med | perf | server | `{{charhistory}}` / `{{userhistory}}` / `{{lorebook}}` CBS callbacks scan and re-parse the entire transcript/lore per invocation |
| M5 | Med | perf | server | Single-row character/chat PATCH routes re-normalize the entire character+chat corpus per edit, twice for character PATCH |
| M6 | Med | perf | server | Foreign field-mode projection of a char-unrelated field still parses the entire characters corpus |
| M7 | Med | perf | client | Server-backed send deep-clones the entire transcript for every `replace_all` message patch |
| M8 | Med | perf | client | Plugin `pluginStorage.getItem` deep-clones the entire database per key read |
| M9 | Med | perf | client | `changedChatMetadata` deep-clones the full chat (all messages) twice to diff scalar metadata |
| M10 | Med | perf | client | Module enable/create/update/delete snapshots deep-clone the whole characters array unnecessarily |
| M11 | Med | both | client | Lorebook watcher echoes foreign projection edits back to the server (no apply-epoch guard) |
| M12 | Med | both | client | Character-profile watcher echoes foreign character-row edits back to the server (no apply-epoch guard) |
| M13 | Med | perf | client | Prompt-template editor re-tokenizes the entire template (twice) on every keystroke |
| M14 | Med | both | client | `startObserveDom` re-attaches a contextmenu listener to every code block 10×/second and scans the whole document at 10 Hz |
| M15 | Med | both | client | Auto-translate render cache is two parallel unbounded arrays with O(n) `indexOf` per chunk — O(n²) over a session, never freed |
| M16 | Med | perf | client | Default-Google translation re-parses + re-fetches per streaming frame (`DoingChat` only guards exp translators) and logs full message HTML |
| M17 | Med | perf | client | LLM cached-only auto-translate runs an extra full `ParseMarkdown` + IndexedDB read per message on every GUI-reload remount |
| M18 | Med | stab | client | TTS playback creates a new `AudioContext` per call and never closes it |
| M19 | Med | stab | client | `bergamotTranslate` serializes through a module-global promise that, once rejected, permanently poisons every later translation |
| M20 | Med | stab | client | MCP HTTP `request()`/handshake have no timeout or abort — a hung MCP server blocks generation paths indefinitely |
| M21 | Med | stab | client | CharX importer 50 MB asset guard is defeated by an operator-precedence bug; oversized entries buffer fully in memory |
| M22 | Med | stab | client | `sendPofile` silently truncates `.po` translation files at ~100 lines (leftover testing cap) |

59 low-severity findings follow in [Low-Severity Findings](#low-severity-findings);
18 informational findings in [Informational Findings](#informational-findings).

---

## High-Severity Findings

### H1 — V2 trigger interpreter has no abort check, wall-clock budget, or hard iteration/recursion cap

- Category: stability · Area: server
- Location: `server/fastify/src/prompt/triggers.ts:740` (`v2EndIndent`
  `endOfLoop`), `:769` (`loopTimes` lag guard), `:565`/`:793`
  (`runtrigger`/`v2RunTrigger` recursion gate); entry `runTrigger:414`,
  `TriggerRunContext:144`.

What. Unlike the Lua VM (which got `LuaExecBudget` + signal abort + exec
limits in Phases 4/6), the deterministic V2 effect interpreter in `runTrigger`
has no time budget, no abort-signal field on `TriggerRunContext`, and no hard
loop/recursion cap. A `v2Loop` whose body never reaches `v2BreakLoop` loops
forever: `v2EndIndent` with `endOfLoop` rewinds `index` to the loop start, and
the only guard is `loopCounts['loopTimes'] > 100 → await sleep(1)`, which
merely yields and resets the counter, never terminating. `v2LoopNTimes` is
bounded only by a user-controlled count that can be enormous. Separately, the
recursion gate `recursiveCount < 10 || trigger.lowLevelAccess` removes the
depth cap entirely for low-level cards, so a self-targeting `runtrigger`
recurses without bound.

Impact / trigger. A malformed or hostile card makes a `/generate/chat`
request that never completes and pins a CPU core (the `sleep(1)` keeps the
loop alive but the work never stops). Critically, `state.signal` is threaded
into the Lua runtime but never consulted in `runTrigger`, so cancelling or
closing the tab does not stop it, and there is no operator-facing timeout —
in the browser the user could close the tab; on the server nothing unwinds
it. Live per-send: input triggers run at `assemble.ts:641` (mode `input`, not
subject to the display/request allowlist) and output triggers post-gen.
Verifier calibration: exploitation is essentially self-inflicted on a
single-user self-host (import/author a bad card), and the structure is a
faithful port of the SPA original — but the missing server-side abort/budget
is a genuine hard-hang liveness defect that Lua already solved.

Fix. Thread `state.signal` into `TriggerRunContext` and check
`signal?.aborted` in the effect loop and at each `v2EndIndent` loop-back. Add
a hard total-iteration ceiling for `v2Loop`/`v2LoopNTimes` and a wall-clock
budget for `runTrigger` (analogous to `LuaExecBudget`); keep recursion bounded
even with `lowLevelAccess` (or charge a shared budget).

---

### H2 — Chat creation runs a whole-corpus hydrate + deep clone + full message diff to insert one empty chat

- Category: performance · Area: server
- Location: `server/fastify/src/routes/commands.ts:2759`
  (`POST /commands/characters/:characterId/chats`) →
  `commands/mutations.ts:416` (`applyJsonCommandMutation`);
  `repository.ts:917` (`loadPersistedWithMessages`), `:1143`
  (`syncChatMessages`); `messageStore.ts:451` (`getAllChatMessagesGrouped`).

What. The chat-create route uses `applyJsonCommandMutation` — the fully
hydrated whole-corpus path. Per request it (1) reads and `JSON.parse`s EVERY
active message and hypaV3 blob of EVERY chat in the corpus
(`loadPersistedWithMessages`), (2) `cloneJsonValue`-deep-clones the entire
hydrated database, and (3) `syncChatMessages` walks every chat running
`applyChatMessageDiff` (per-message `JSON.stringify` over the shared prefix)
plus a `JSON.stringify(hypaV3)` equality check per chat — then rewrites the
full characters/collections/settings tables. The kit already has
`insertCharacterChatRow` + `writeCharacterChatRows` +
`replaceActiveChatMessages`, used by the *fork* route (`:3018-3020`), which
does the same insert as a couple of targeted row writes.

Impact / trigger. Cost scales with TOTAL corpus message volume, not the one
new (empty) chat: on a populated corpus this is tens-to-hundreds of MB parsed,
cloned, re-stringified, and re-diffed on the event loop per "New Chat" click —
a routine user action. Verifier note: this is NOT the gated `v1-L7` item. The
four L7 routes use `applyMessageFreeJsonCommandMutation` (no message
hydration, no clone, no diff); chat-create uses the strictly heavier hydrated
path and is a separately fixable miss, not covered by the L7 deferral.

Fix. Route chat-create through `applyTargetedCommandMutation` with the kit
writers like the fork route: `ensureCharacterChats`/unshift on a scoped read,
then `writeCharacterChatRows` + `insertCharacterChatRow(position 0)` +
`replaceActiveChatMessages(newChatId)` + `writeSingleCharacterRow`. Avoid
`loadPersistedWithMessages`/`cloneJsonValue`/`syncChatMessages` entirely for
single-chat creation.

---

### H3 — Every variable-changing trigger pass remounts and fully re-parses ALL visible messages

- Category: performance · Area: client
- Location: `src/ts/stores.svelte.ts:171` (`ReloadGUIPointer.subscribe` →
  `ReloadChatPointer.set({})` + `resetScriptCache()`);
  `src/lib/ChatScreens/Chat.svelte:690`/`:706` (`{#key chatReloadPointer}`);
  `src/ts/process/triggers.ts:3420` (`runTrigger` `varChanged` bump), `:2795`
  (`v2UpdateGUI` unconditional bump).

What. Any `ReloadGUIPointer` increment changes the `{#key}` for EVERY
rendered message and forces a full `ChatBody` remount, re-running the entire
async `ParseMarkdown` pipeline (additional-asset parse, `editdisplay`
scripts + display triggers, markdown render, highlight, DOMPurify) per visible
message. The same subscriber also calls `resetScriptCache()`, wiping
`processScriptCache` AND `compiledRegexCache` (`scripts.ts:140-143`), so the
post-remount re-parse runs display triggers and regex scripts *cold* — the
Phase 7 regex memo cannot help across a reload. Each `Chat` additionally
re-runs the synchronous `displaya()`/`risuChatParser` pass via its own
subscription.

Impact / trigger. One trigger that writes one chat variable re-parses every
on-screen message from scratch: O(visibleMessages × fullPipelineCost) per
bump. Verifier calibration of the trigger: on the default server-backed
runtime, normal AI turns do NOT bump it (the output trigger runs server-side
and applying the scriptstate delta does not touch `ReloadGUIPointer`). The
live bump sites are: manual/sticker/command (`/trigger`) trigger passes with
`varChanged`, every `{{v2UpdateGUI}}` effect, the `reloadDisplay` scripting
API, module/settings changes, and the local-assembly fallback path (where
`applyOutputTrigger` runs per turn). So the cost is per GUI-reload-class
action rather than per ordinary turn — still a whole-screen cold re-parse per
event, scaling with message length and count.

Fix. Decouple variable-state reactivity from the global remount: bump only
per-message `ReloadChatPointer` entries for messages whose displayed content
depends on the changed variable, or drop the `{#key}` remount in favor of
letting `markParsingResult` re-derive. Critically, stop wiping
`processScriptCache`/`compiledRegexCache` on var-only changes — the wipe is
what makes each remount cold (note: any fix must address the module-level
cache, not `ChatBody`'s instance-local `lastCharArg` guard, which resets on
remount anyway and only protects translate-detection).

---

## Medium-Severity Findings

### Server — prompt assembly / CBS interpreter

### M1 — Full chat transcript is `structuredClone`d and `JSON.stringify`d several times per assembly even when unchanged

- perf · server · `server/fastify/src/prompt/assemble.ts:516`
  (`captureMessageReplacement`; eager `cloneMessages(after)` at `:521` BEFORE
  the `equalJson` early-return at `:522`); callers `:794`
  (`applyCurrentChatRunVars`), `:989` (`fillHistoryAndBias`),
  `:659`/`:713`/`:758`/`:1668`; plus `resolveScope:432`, `beginAssembly`
  (initialMessages + messageMutationCheckpoint), `appendUserMessageRow:559/578`
  (send mode), `captureSubmitTranscript`, `buildRestorationPayload`.

`captureMessageReplacement` unconditionally `structuredClone`s the entire
working transcript and `JSON.stringify`s BOTH the previous-checkpoint and new
transcripts before detecting "no change". It fires unconditionally for the
`run_var` and `history_normalize` stages on every assembly — and
`history_normalize` is *always* a no-op in the no-trigger case
(`buildHistoryWindow` builds a separate `OpenAIChat[]` and never mutates
`currentChat.message`), so its clone + 2× stringify is pure waste every send.
Counting all sites (including `runServerPostGeneration`), a plain send pays
~6-12 full-transcript `structuredClone`s and ~4-8 full `JSON.stringify`
passes, all on the event loop, scaling linearly with chat length (MB-scale for
long chats). Fix. Track a dirty flag set by the actual mutators (run-var
`dirty`, trigger `varChanged`, editinput change) and skip the capture when
nothing mutated; where a compare is genuinely needed, compare before cloning
(lengths + per-message hash) and clone only on confirmed change.
`appendUserMessageRow` needs a single-row splice, not a full re-clone.

### M2 — History walk re-parses every message through `risuChatParser` with no marker-free short-circuit

- perf · server · `server/fastify/src/prompt/history.ts:289`
  (`formatHistoryMessage` → `expandVariables(msg.data)`), loop
  `history.ts:488-503`; compare `assemble.ts:768/:780`
  (`isRunVarParserFixedPoint` — applied to run-vars only). Residual of the
  landed `v1-L2` fix.

`formatHistoryMessage` unconditionally CBS-parses every history-window message
on every send: a full-string `<user|char|bot>` regex replace plus the
character-by-character `risuChatParser` walk, both O(message length), even for
plain prose with no `{{` markers. The `v1-L2` fix (`c193c008`) added the
`isRunVarParserFixedPoint` guard to `applyCurrentChatRunVars` but never to
this parallel call site, so the same messages are fully re-scanned per send —
a per-send tax linear in retained transcript length (~15-30 ms typical,
<150 ms multi-MB worst case), fully redundant for marker-free text. Fix.
Apply the same fixed-point guard in `formatHistoryMessage` (skip
`expandVariables` when `!text.includes('{')` and no `<user|char|bot>` match),
and/or cache expanded output per message revision across sends.

### M3 — `renderContentCard` runs full CBS expansion (and slot clones) twice per assembly

- perf · server · `server/fastify/src/prompt/templates.ts:372`
  (`renderContentCard`); callers `preflight.ts:101`
  (`preflightTemplateTokens`, via `assemble.ts:912`) and `templates.ts:583`
  (final render walk); CBS sites `templates.ts:444` (plain/jb/cot
  `expandVariables`), `:383` (innerFormat), `:459` (`parseChatML`),
  `:401-:406` (slot `structuredClone`s).

Every template render invokes `renderContentCard` once in the token preflight
(result discarded except `addedTokens`) and again in the final render. For
`plain`/`jailbreak`/`cot`/`chatML` cards the full CBS expansion of the card
body runs twice; innerFormat wrappers and slot clones double too. Verifier
scoping: this is live only when a prompt template is configured
(`usingPromptTemplate` — true for imported SillyTavern/Risu presets, not the
fresh-default `formatingOrder` path); the chat-history card is NOT doubled
(preflight runs before history is bridged, so it returns `[]` there); and the
intervening stages mutate `unformated.chats`/`postEverything`, so those cards
must NOT be memoized. There is also a latent correctness wrinkle: CBS with
side effects (`{{setvar::}}`) in a card body is evaluated twice, with the
preflight's mutation applied and discarded. Fix. Render the stable card
subset (plain/jailbreak/cot, persona/description/authornote innerFormat,
chatML) once, cache per card within the assembly, and have the preflight
tokenize the cached rows; leave chat/postEverything cards live.

### M4 — `{{charhistory}}` / `{{userhistory}}` / `{{lorebook}}` CBS callbacks scan and re-parse the entire transcript/lore per invocation

- perf · server · `src/ts/cbs.ts:387` (`charhistory`), `:364`
  (`userhistory`), `:341` (`lorebook`); reached via `risuChatParser` →
  `matcher` from any server `expandVariables` site (e.g. plain card
  `templates.ts:444`, lorebook rows `lorebook.ts:794`).

The `charhistory`/`userhistory` callbacks iterate the FULL current transcript
and run a nested full `risuChatParser` parse plus `JSON.stringify` per
matching message, then another stringify pass via `makeArray` — O(transcript)
work with nested parses inside what looks like an O(1) prompt section, per
send, on the event loop. A preset embedding `{{charhistory}}` in a
plain/globalNote/jailbreak section also pays it twice via M3. Verifier
corrections: the `{{lorebook}}` callback's module-lore component is dead on
the server (`cbsAdapter.ts:123` wires `getModuleLorebooks: () => []`), so its
cost is character+chat lore only; description/persona cards are pre-expanded
once in `staticSections`, so the doubling applies to the inline-expanded card
kinds. Fix. Memoize these callbacks' output per (chat revision) within an
assembly, and land M3 so they run once.

### M5 — Single-row character/chat PATCH routes re-normalize the entire character+chat corpus per edit, twice for character PATCH

- perf · server · `server/fastify/src/routes/commands.ts:2583` & `:2595`
  (character PATCH calls `ensureCharacterCollection` twice);
  `commands/characters.ts:53` (`ensureCharacterCollection`), `:122`
  (`repairCharacterRecord`); `commands/chats.ts:419`
  (`normalizeAllCharacterChats`); `repository.ts:288`
  (`loadCharactersFromSqlite`). Residual of `v1-M3` (the narrowing reached the
  message/scriptstate routes only).

A character rename or chat-metadata PATCH still does the broad
`loadPersisted` (one O(corpus) JSON parse — dominated by the characters table:
6.85 MB across 50 characters on the reference DB) and then maps
`repairCharacterRecord` (~25 default-field spread + validation) over EVERY
character; the character PATCH handler runs the in-memory repair pass twice
(~73 ms per PATCH measured, ~30 ms of it the duplicate call). The write side
was narrowed in v1; this read+normalize side was not. Constraint for the fix:
the chat PATCH needs the modules collection when `patch.modules` is present
(`ensureModuleRecords` + `validateNormalModuleLinks`), which the current
`loadPersistedForChatMutation` scoped read does not carry — the scoped read
must include modules or fall back to broad only in that case. Fix.
Single-row scoped read + single-row repair for both PATCH routes; the second
`ensureCharacterCollection` call collapses into the single-row repair.

### M6 — Foreign field-mode projection of a char-unrelated field still parses the entire characters corpus

- perf · server · `server/fastify/src/routes/projection.ts:434` (field
  branch) → `repository.ts:755` (`loadPersistedDatabaseFields`) / `:766`
  (`loadStubbedProjectionFields`) → `loadPersisted` →
  `loadCharactersFromSqlite`.

Every field-mode projection resource (`preset`, `persona`, `plugin`,
`moduleEnabled`, …) loads and parses every characters row (the chats rows are
message-free and negligible) and then throws it all away to return one
unrelated settings-scale field. Live trigger: `src/ts/bootstrap.ts:326`
fetches the resource per foreign command event — own-echo is suppressed, so
this fires only with a second tab/device editing collections, which is
uncommon in single-user use (one verifier lens rated it low for that reason);
the waste per event is O(characters payload), tens of ms of blocking parse on
a large library for a kilobyte-scale answer. Fix. Field-scoped loaders that
read only the SQLite tables backing the requested `fieldKeys`
(`COLLECTION_TABLE_MAP` + settings row) and skip `loadCharactersFromSqlite`
unless `characters` is requested — mirroring `loadSingleCharacterStubRow`.

### Client — send path / state / bridges

### M7 — Server-backed send deep-clones the entire transcript for every `replace_all` message patch

- perf · client · `src/ts/process/request/serverMessagePatch.ts:22`
  (`applyMessageMutation` → `cloneMessages` = `structuredClone`); callers
  `serverBackedSendChat.ts:110-115` (assembly patch) and `:451` (terminal
  patch); produced by `assemble.ts:516-531` (`captureMessageReplacement`).

Each `replace_all` mutation in a `message_patch`/`done` frame assigns
`chat.message = structuredClone(mutation.messages)` — but `mutation.messages`
is already a private freshly-deserialized array, so the clone is pure
redundant O(transcript) main-thread work inside
`withTrustedServerProjectionWrite`. Frequency (verifier-calibrated): the
server emits `replace_all` only when a stage actually changed transcript bytes
(`equalJson` guard + run-var fixed-point skip), so plain-prose chats pay
nothing, but any chat whose stored bodies re-evaluate (CBS /
`{{getvar}}`/`{{setvar}}` markers) or that runs input/edit/output triggers
emits one or more per send — and one patch can carry several `replace_all`
mutations, each cloned. Fix. Assign `mutation.messages` directly (or one
shallow array copy). Longer-term, emit changed-index incremental mutations
instead of `replace_all` for run_var/trigger sources.

### M8 — Plugin `pluginStorage.getItem` deep-clones the entire database per key read

- perf · client · `src/ts/storage/database.svelte.ts:944` (`getDatabase`
  snapshot path); caller `src/ts/plugins/plugins.svelte.ts:1129`
  (`pluginStorage.getItem`).

`getItem(key)` calls `getDatabase({snapshot:true})` — a `$state.snapshot`
deep clone of the WHOLE database (every character, hydrated chat, message,
collection) — to read one scalar from `db.pluginCustomStorage[key]`. The
sibling accessors (`key`, `keys`, `length`) use the non-snapshot
`getDatabase()`; only `getItem` snapshots (an apparent oversight). This is the
documented primary storage-read API for V2 and V3 plugins; a stateful plugin
reading config per message or per render multiplies a multi-MB clone by call
frequency. Fix. `cloneJsonValue(getDatabase().pluginCustomStorage?.[key]) ??
null` — snapshot the one key, not the database.

### M9 — `changedChatMetadata` deep-clones the full chat (all messages) twice to diff scalar metadata

- perf · client · `src/ts/chatCommands.ts:1022` (`changedChatMetadata`);
  callers `buildCompatibleChatUpdateFactories:473`,
  `dispatchCompatibleChatUpdateScoped:437`, `setCurrentChat`
  (`database.svelte.ts:1027`), `mutateCurrentChatMessages`
  (`process/command.ts:357`). Un-narrowed twin of the fixed `v1-M13`.

`cloneJsonValue(previous)` + `cloneJsonValue(current)` on whole `Chat` objects
(including `message[]`, `localLore[]`, `hypaV3Data`), after which
`sanitizeChatPatch` discards everything except the 12 small keys in
`CHAT_PATCH_ALLOWED_KEYS`. The entire history is JSON round-tripped twice for
a tiny metadata diff, per slash-command/plugin chat mutation —
`setCurrentChat` already cloned both chats once more via
`currentChatScopedSnapshot`, so a long chat's messages get cloned 3× per
mutation. Fix. Mirror the `v1-M13` remedy: iterate only
`CHAT_PATCH_ALLOWED_KEYS` over the raw records, compare per key, clone only
changed allowed values.

### M10 — Module enable/create/update/delete snapshots deep-clone the whole characters array unnecessarily

- perf · client · `src/ts/moduleCommands.ts:33`
  (`currentModuleStateSnapshot`); callers `setGlobalModuleEnabled:114`,
  `createGlobalModule:131`, `updateGlobalModule:142`, `deleteGlobalModule:156`,
  `dispatchReorderModules`; also `plugins/plugins.svelte.ts:669` and
  `process/mcp/risuaccess/modules.ts:478`.

`currentModuleStateSnapshot()` clones `modules`, `enabledModules`, AND the
entire `characters` array (with every hydrated chat history) — but the
global-module commands never mutate `characters`, so every settings-UI module
toggle pays a corpus-scaling clone for a rollback that cannot need it.
Verifier additions: on the live server path the four global functions perform
NO optimistic write at all (the optimistic branch is dead since
`canUseServerCommands()` is always true), so even the modules clone is wasted;
and the character-scoped paths (`toggleSelectedCharacterModule`,
`dispatchReorderCharacterModules`) only touch one character's `.modules`
string array, so they need a single-character snapshot, not the full array
either. Fix. A module-only snapshot for the global paths; a single-row (or
single-field) snapshot for the character-module paths.

### M11 — Lorebook watcher echoes foreign projection edits back to the server (no apply-epoch guard)

- both · client · `src/ts/server/lorebookBridge.svelte.ts:554`
  (`watchServerBackedLorebooks`; diff loop `:589-595`); callers
  `LoreBookSetting.svelte`, `lorepreset.svelte`, `ModuleMenu.svelte`.

Unlike the sibling chat/script/settings watchers, this watcher never reads
`getServerProjectionApplyEpoch()`. When a foreign lorebook command event is
applied, the effect diffs the server-originated change against its stale
baseline and dispatches `dispatchReplaceGlobalLorebookEntries` /
`dispatchReplaceCharacterLorebooks` / etc. — echoing the server's own edit
back as a brand-new command (full-collection write + revision bump, one
self-terminating bounce back to the originating session). Requires a second
session with a lorebook panel mounted, so frequency is low, but the write-back
scales with lorebook size. Fix. Add the same apply-epoch gate the other
watchers use; note `hydrateServerCharacterLorebook` runs under
`withTrustedServerProjectionWrite` which does NOT bump the epoch — switch
foreign character-lorebook application to `withServerProjectionApply` so the
gate covers it.

### M12 — Character-profile watcher echoes foreign character-row edits back to the server (no apply-epoch guard)

- both · client · `src/ts/server/characterBridge.svelte.ts:100`
  (`watchServerBackedCharacterProfile`; diff `:126-148`); caller
  `CharConfig.svelte`.

Same asymmetry as M11 for the character-profile watcher: a foreign
`character` event applied via `mergeServerProjectionCharacterRow` re-runs the
effect, which sees the foreign change as a local edit and (after the 300 ms
debounce) dispatches `updateCharacter` echoing it back. Bounded: only the
changed scalar fields are echoed, one self-terminating bounce, and it needs
two sessions on the same open character. The exposing surgical-merge path
landed 2026-06-03 (`608de26c`), after the v1 audit — genuinely new, not a
regression of an audited item. Fix. Track
`previousProjectionApplyEpoch` and reset the profile snapshot without
dispatching when the epoch advanced.

### Client — render / editor / UI

### M13 — Prompt-template editor re-tokenizes the entire template (twice) on every keystroke

- perf · client · `src/lib/Setting/Pages/PromptSettings.svelte:357`
  (`$effect.pre` → `executeTokenize`), `:113`; `tokenizePreset`
  (`process/prompt.ts:74`), `tokenizeAccurate` (`tokenizer.ts:460`).

The `$effect.pre` deep-tracks `promptTemplateDraft.value` and on each change
runs `tokenizePreset(prest, true)` AND `tokenizePreset(prest, false)` — two
full passes that CBS-parse (`risuChatParser`) and tokenize every PromptItem.
Every keystroke in a prompt-item textarea mutates the draft, so editing the
central preset-tuning surface re-tokenizes the whole template twice per
keystroke with no debounce or per-item memo (contrast `CharConfig.svelte`'s
`scheduleTokenize`). Verifier nuances: Svelte's async-effect tracking means
the re-fire is guaranteed for edits to the first tokenizable item (typically
the main/jailbreak prompt) and may skip later items; and the LRU `encodeCache`
(when `useTokenizerCaching` is on) blunts the *encode* for unedited items but
the CBS parse still runs for every item every keystroke, doubled. The v1 work
debounced the server WRITE (`queuePromptItemUpdate`, 250 ms) but not this
token recompute. Fix. Debounce (trailing 250-400 ms + run counter) and/or
memoize per item by `(id, text, innerFormat)`; compute the `consti` variants
once.

### M14 — `startObserveDom` re-attaches a contextmenu listener to every code block 10×/second and scans the whole document at 10 Hz

- both · client · `src/ts/observer.svelte.ts:90` (`startObserveDom`
  `while(true)` + `sleep(100)`), `:6` (`nodeObserve`, non-idempotent
  `addEventListener` at `:11`); wired from `bootstrap.ts:129` for the app
  lifetime.

Every 100 ms, `document.querySelectorAll('[x-hl-lang],[risu-ctrl]')` scans the
entire document and `nodeObserve` unconditionally adds a fresh `contextmenu`
listener to every code block — ~36k listeners/hour per stable on-screen
block, never removed while the node lives (re-rendered nodes release theirs to
GC). The `MutationObserver` constructed at `:92` is never `.observe()`d
(dead), so the 10 Hz poll is the only mechanism. User-visible breakage is
mild (the handler de-dupes the menu element, so N handlers do redundant
remove+append churn rather than stacking menus); the continuous costs are the
permanent 10 Hz whole-document scan and monotonic listener/memory growth over
long sessions. Fix. Mark processed nodes (WeakSet / data attribute) or
actually wire the constructed `MutationObserver`
(`observe(document.body, {childList:true, subtree:true})`) so each node binds
exactly once; detach on removal.

### Client — translate / TTS / MCP / import (opt-in subsystems)

### M15 — Auto-translate render cache is two parallel unbounded arrays with O(n) `indexOf` per chunk

- both · client · `src/ts/translator/translator.ts:21` (`cache =
  {origin:[…], trans:[…]}`), `:46/:51` (`indexOf` lookup), `:123/:125`
  (unbounded push); callers `ChatBody.svelte:128/:144/:153` (`translateHTML`
  per text-node chunk).

The translation memo is two plain arrays searched linearly per chunk and
pushed without cap, eviction, or de-dup (and `runTranslator` is also called
directly from `translateVox`/huggingface, bypassing the lookup). With
auto-translate on (opt-in; default false) and the default `google` translator,
every visible-message render scans the entire accumulated session cache once
per chunk — O(visibleMessages × chunks × cacheSize), degrading over long
sessions, and the arrays are never freed (multi-day self-host sessions leak
steadily; `clearLLMCache()` clears a different store). Aggravator the finder
missed (per verifier): `isExpTranslator()` covers only llm/deepl/deeplX, so
for google `DoingChat` does NOT suppress `translateHTML` during streaming —
each streaming frame fires fresh per-chunk translate fetches and fresh
unbounded pushes (see M16). Fix. Replace with a bounded `Map` keyed
`${reverse}|${text}` (LRU), de-dup before push, reset on chat switch.

### M16 — Default-Google translation re-parses + re-fetches per streaming frame and logs full message HTML

- perf · client · `src/ts/translator/translator.ts:344`
  (`console.log(html)` in the DOM-walk branch); guard `:310-316`
  (`DoingChat` + `isExpTranslator`); `isExpTranslator:276`; caller
  `ChatBody.svelte` `translateHTML`.

The default Google path runs `new DOMParser().parseFromString(html)` plus
`console.log(html)` on every translated render. Because the `DoingChat`
early-return only covers exp translators (llm/deepl/deeplX), a streaming
message with google auto-translate is re-DOM-parsed and re-translated per
render frame on an ever-growing string — O(L²) DOM work over the stream, with
the real dominant cost being the per-frame network fan-out to
translate.googleapis.com (per text node, cache-missing every frame as the text
grows). Verifier corrections: the `:382/:392` logs are deeplX-only (already
suppressed mid-stream); the per-token exposure is specifically the google
fallthrough. Fix. Remove the stray `console.log(html)` (and the
translate-chunk logs), and extend the `DoingChat` suppression to non-exp
translators so in-flight streaming messages are not re-translated per frame.

### M17 — LLM cached-only auto-translate runs an extra full `ParseMarkdown` + IndexedDB read per message on every GUI-reload remount

- perf · client · `src/lib/ChatScreens/ChatBody.svelte:86-97`
  (`autoTranslateCachedOnly` detection → `ParseMarkdown('pretranslate')` +
  `getLLMCache`); remount via `Chat.svelte:706` (`{#key}`).

In LLM cached-only auto-translate mode, deciding *whether* a cached
translation exists costs a full extra `ParseMarkdown` plus an
IndexedDB/localforage roundtrip per message. The detection sits behind the
instance-local `lastCharArg`/`lastChatId` guard, which resets on every
`{#key}` remount (H3), so each GUI reload re-runs it for every visible
message. Scope (verifier-calibrated): gated behind a narrow non-default
config (autoTranslate + cachedOnly + llm + `translateBeforeHTMLFormatting`
off); N is the windowed visible set (`loadPages`, default 30), not the corpus;
the regex-script part of the detection parse hits `processScriptCache` when
warm. Fix. Memoize the cache-key parse by content hash at module level (so
it survives remounts), or derive the key without a full `ParseMarkdown`.

### M18 — TTS playback creates a new `AudioContext` per call and never closes it

- stab · client · `src/ts/process/tts.ts:76` (`playAudio` `new
  AudioContext()`), `:401` (gptsovits gain path, second context); no
  `.close()`/`onended` teardown; `stopTTS():469` only stops the source. Live
  via the per-message TTS button, `/tts`, and auto-TTS after each generation.

Every playback constructs an `AudioContext` that is never closed; the
module-global `sourceNode` is overwritten next call, leaving the previous
context (audio thread + decoded buffers) alive for the page lifetime. With
auto-TTS this grows once per assistant message. Verifier calibration: the
historic Chrome ~6-context hard cap has been raised/removed in modern builds,
so "TTS dies after 6 plays" is uncertain; the reliable impact is progressive
audio-thread/memory leakage in long sessions, scoped to network-voice TTS
modes (webspeech/vits never construct a context) and reload-recoverable. Fix.
Reuse one lazily-created module-level context (resume on user gesture), or
close per-call contexts in `sourceNode.onended`; do the same for the gain-path
context and release nodes in `stopTTS()`.

### M19 — `bergamotTranslate` serializes through a module-global promise that, once rejected, permanently poisons every later translation

- stab · client · `src/ts/translator/bergamotTranslator.ts:130`
  (`translateTask`), `:140` (chain), `:144-152` (`await` prior task before
  translating); callers `translator.ts:211/:338`.

Each bergamot call awaits the previous `translateTask` before translating,
with no `.catch` and no reset on failure. One rejection (model fetch failure,
wasm error) makes `translateTask` a rejected promise; every subsequent call
re-throws at the `await` without reaching the translator, forever. The
`LatencyOptimisedTranslator` instance is also never re-created (`??=`), so
recovery requires a page reload. Fix. Chain on
`translate().catch(() => {})` (or clear `translateTask` in
`finally`), and re-instantiate the translator on hard wasm errors.

### M20 — MCP HTTP `request()`/handshake have no timeout or abort

- stab · client · `src/ts/process/mcp/mcplib.ts:360` (`MCPClient.request`
  fetch with a never-aborted controller and no `requestTimeoutMs`), `:341-358`
  / `:418-435` (SSE-resolution promises with no timeout), `:542` (handshake
  SSE-fallback GET); dispatch `mcp.ts:217` (`callMCPTool`), `:189`
  (`getMCPTools`).

Every remote-HTTP MCP operation — handshake, `tools/list`, `tools/call` —
awaits indefinitely if the MCP server hangs or never streams the matching-id
response: the fetch carries a live-but-never-fired signal and the resolution
promises only settle on a matching event. Scope (verifier-corrected): the
default main-chat send is server-backed and does not touch client MCP; the
live exposure is auxiliary client `requestChatData` calls (translator,
triggerlua LLM, HypaV3 memory, image-gen, emotion classification) plus agentic
tool loops, and it requires an enabled remote-HTTP MCP module (opt-in;
handshake/tool-list are cached after first success, `tools/call` hangs per
invocation). A flaky third-party MCP endpoint then stalls the affected path
with no recovery except user abort. Fix. Thread a bounded deadline into
`request()` (pass `requestTimeoutMs` to `fetchNative`, wire the controller to
a timer), race the SSE-resolution promises against a timeout that removes the
listener and rejects as an RPC error, and apply the same to the handshake GET.

### M21 — CharX importer 50 MB asset guard is defeated by an operator-precedence bug

- stab · client · `src/ts/process/processzip.ts:352` (`#handleFile`:
  `if (file.originalSize ?? 0 < MAX_ASSET_SIZE_BYTES)` — parses as
  `file.originalSize ?? (0 < MAX)`), `#handleFileData:361`,
  `#handleFileComplete:372`; caller `characterCards.ts:157`.

`<` binds tighter than `??`, so the intended pre-emptive size skip is a no-op
for any entry with a known non-zero `originalSize`: the whole entry streams
into the in-memory `AppendableBuffer` and is only *excluded after* full
accumulation. Importing a crafted or simply huge `.charx`/jpeg-wrapped card
buffers a multi-hundred-MB entry in RAM before exclusion. Verifier
strengthening: the parenthesized fix alone is insufficient —
`originalSize` is undefined for data-descriptor zip entries, and fflate
buffers the *compressed* bytes internally until `file.start()` runs — so a
running byte cap inside `#handleFileData` with `file.terminate()` is the
load-bearing fix. Fix. `(file.originalSize ?? 0) < MAX_ASSET_SIZE_BYTES`
AND a mid-stream cumulative cap that abandons the entry once it exceeds the
limit.

### M22 — `sendPofile` silently truncates `.po` translation files at ~100 lines

- stab · client · `src/ts/process/files/multisend.ts:105` (`if (i > 100)
  break`, comment "prevent too long message in testing"); entry `postChatFile`
  case `'po'` `:247`; live via the chat file-send button
  (`DefaultChatScreen.svelte:1163`).

A leftover testing cap hard-breaks the line loop past index ~100: any real
`.po` file longer than that silently loses all later content, and the partial
result is written out as `translated.po` as if complete — shipped test
scaffolding causing silent data loss on a real (niche, manual) utility path.
Fix. Remove the cap (or make it a configurable limit with an explicit
warning when exceeded).

---

## Low-Severity Findings

59 confirmed low-severity findings. Bounded, infrequent, or latent foot-guns
under single-user self-host, but real and actionable. Grouped by area; the
location is the durable anchor. Titles incorporate verifier corrections.
[KL] = overlaps a `leftover.md` evidence gate; [v1-*] = residual adjacent to a
landed v1 fix.

### Server — generation / jobs

| ID | Title | Location |
| -- | ----- | -------- |
| L1 | Durable generation hard-capped at 600 s wall-clock (fixed, not sliding; no client override) — a legitimately slow local-model generation is persisted as a truncated/cancelled turn | `routes/generationChat.ts:1760` (`startDurableGeneration`); `streamJobs.ts:255/:372` |
| L2 | Terminal-failed rows in `generation_finalization_retries` are never deleted (slow unbounded growth) | `generationFinalizationRetry.ts:97` (`markGenerationFinalizationRetryFailure`) |
| L3 [KL] | `server-intent /generate/completion` loads the full corpus per secondary AI call (translate/memory/emotion) just to read a few settings scalars | `routes/generation.ts:1254` (`handleServerIntentCompletion` → `loadPersisted`) |

### Server — prompt assembly / triggers / Lua

| ID | Title | Location |
| -- | ----- | -------- |
| L4 | Lorebook `@@keep`/`@@dont_activate_after_match` chat-var writes land on the throwaway clone and are never persisted (sticky activation lost across sends) | `prompt/lorebook.ts:629-633` (`writeChatVar`); diff base `assemble.ts:797` |
| L5 | `searchMatch` re-lowercases and re-regex-strips the scanned messages on every call inside the O(N²) recursive activation loop (Phase 7 L3 memoized only key regexes) | `prompt/lorebook.ts:227` (`searchMatch`); loop `:580` |
| L6 | Trigger `exists` conditions and V2 data effects recompile `RegExp` per evaluation inside loops, and rebuild a full transcript `slice/map/join` per evaluation | `prompt/triggers.ts:386`; `triggerDataEffects.ts:520/:199/:170/:544` |
| L7 | `runTrigger` `structuredClone`s the whole character before the `triggers.length === 0` early-return (message-free on the live assembly path, so metadata-scale; clone-before-check is still backwards) | `prompt/triggers.ts:421-430` |
| L8 | `SEND_NAME_WRAPPER` constant is CBS-parsed once per history message instead of once per assembly | `prompt/history.ts:324`; loop `:488` |
| L9 | Lorebook depth-prompt bodies are CBS-expanded twice per send (token preflight + actual splice; first result discarded) | `prompt/history.ts:510-517` and `:565-569`; caller `assemble.ts:1055` |
| L10 | `{{#each}}` over a large array materializes `array.length` full-body copies with a `JSON.stringify` + `replaceAll` per element, then re-scans the whole expansion (no cap) | `src/ts/parser/risuChatParser.ts:624-657` |
| L11 | Per-CBS-tag matcher allocates split arrays and runs locale-aware lowercasing + regex per tag, per parse, per message | `src/ts/parser/risuChatParser.ts:77-84` |
| L12 [KL] | Fresh-boot Lua runs serialize behind every in-flight Lua run (pool target 2); a run holding an engine on a host-fn fetch (capped 10 s, not 600 s) parks the third concurrent assembly | `prompt/luaRuntime.ts:1216/:1235/:1107` |

### Server — SQLite / commands

| ID | Title | Location |
| -- | ----- | -------- |
| L13 [v1-L7-adjacent] | Realm character import persists via the whole-corpus hydrate+clone+sync path (one full pass per imported character; one character per request) | `routes/realmImport.ts:539` (`appendRealmCharacter` → `applyJsonCommandMutation`) |
| L14 | `replaceActiveChatMessages` diff re-parses + re-stringifies the whole chat per persisted transcript change (fires only when `submitTranscriptChanged` — input-trigger/editinput rewrites — not every generation) | `messageStore.ts:302/:409/:394`; caller `generationChat.ts:551` |
| L15 | No `PRAGMA synchronous` set: WAL defaults to FULL, fsync on every command commit (set `synchronous = NORMAL` for the standard WAL trade-off) | `db.ts:155` |
| L16 | Bulk projection routes verify the auth assertion twice per request (redundant ECDSA verify: `onRequest` hook + in-handler) | `routes/projection.ts:197/:202` and `:236/:241` |

### Server — Hypa V3 memory

| ID | Title | Location |
| -- | ----- | -------- |
| L17 | `memory_jobs` rows are never pruned: completed/failed/cancelled rows accumulate for the DB lifetime | `memoryRepository.ts:931`; only DELETE is the legacy-import wipe |
| L18 | Worker enforces a fixed 1 s poll gap between every batch — no "did work → tick again" fast path for backlog drains | `memoryWorker.ts:124` |
| L19 | Batch commit fail-cascade marks all later jobs failed when one job hits a transient error (harmful on the independent concurrent path; contextual path is legitimately all-or-nothing) | `memoryEmbedJobHandler.ts:406`; `memorySummarizeJobHandler.ts:123-149` |
| L20 [v1-L16] | `cleanupOrphanedMemory` re-parses all summary metadata per generation once a chat has ANY summary (the landed L16 EXISTS guard only covers zero-summary chats), and the same summaries are parsed again by selection | `memoryRepository.ts:594/:560`; `assemble.ts:1166/:1173` |
| L21 [KL] | A single chunk exceeding the contextual sub-batch budget still travels as an unbounded request body (no per-chunk size ceiling; also true of the single-chunk and non-contextual routes) | `memoryEmbedJobHandler.ts:279/:219`; `memoryEmbeddingAdapter.ts:143` |
| L22 [v1-M7-adjacent] | Contextual (voyageContext3) sub-batching silently changes the embedding context window (chunks formerly co-embedded land in different groups; also triggered by the 32-job drain cap) — a semantic change shipped as a perf fix | `memoryEmbedJobHandler.ts:286/:316` |

### Server — import / export / assets / outbound

| ID | Title | Location |
| -- | ----- | -------- |
| L23 | Realm JSON-card import does one SQLite transaction + revision bump + SSE broadcast PER asset (charx path batches; JSON path does not) | `routes/realmImport.ts:299-309`; `repository.ts:1606` (`addAsset`) |
| L24 | Realm import orphans already-persisted assets when the character append fails (revision conflict path; cleanup left to asset GC's 60-min grace) | `routes/realmImport.ts:284-318/:531-558` |
| L25 [KL] | Bundle export existence-checks asset files up-front but opens them much later mid-stream (TOCTOU vs concurrent backup-restore dir rename → destroyed download instead of a `missingFiles` entry) | `risuSave/bundleExport.ts:67-73/:182-197` |
| L26 | Legacy storage write has no fsync/atomic-rename; crash mid-write can tear client-managed cache files (remote-block + translator caches, not core state) | `routes/legacyStorage.ts:85` |
| L27 | Hub proxy buffers the entire request body (bounded only by the 100 MB bodyLimit, pinned across the redirect re-forward) and has no upstream timeout/abort-on-disconnect | `routes/hub.ts:107-131/:55-96` |
| L28 | Non-multipart `/import/risusave` JSON body is JSON-cloned twice over the full corpus (API-only path; the bundled client restores via `/import/bundle`) | `routes/save.ts:113-115`; `importSnapshot.ts:175`; `repository.ts:1520` |
| L29 | Realm charx staging downloads up to 2 GB to disk before the 100 MB expanded-import cap is consulted (cap the download near the expanded limit / check Content-Length first) | `routes/realmImport.ts:611-676/:463-486` |
| L30 | Vertex bearer cache has no in-flight dedupe: concurrent cold Gemini requests each sign a JWT + POST the token exchange (store the in-flight promise) | `generation/vertexAuth.ts:99` |
| L31 [KL] | Proxy fetch route has no default upstream deadline when `risu-timeout-ms` is absent (which is the common client case); only close-abort bounds it | `routes/proxy.ts:49`; `proxy.ts:19/:32` |

### Client — state / snapshots / storage

| ID | Title | Location |
| -- | ----- | -------- |
| L32 [v1-M12 residual] | `/send`-family slash commands and `mutateCurrentChatMessages` still run the full `setDatabase` normalizer per invocation (M12 narrowed only `/setvar`/`/addvar` and explicitly deferred these) | `process/command.ts:191/:353`; `database.svelte.ts:106` |
| L33 | `removeChar` (trash) uses a whole-corpus snapshot/rollback for a single-field `trashTime` edit (single-row helpers already exist) | `src/ts/characters.ts:917`; `characterCommands.ts:57` |
| L34 | Character-select subscriber clones + server-writes a character row when hypaV3 `alwaysToggleOn` is set (at most once per character lacking `supaMemory`, but full-row clone for a one-flag patch) | `stores.svelte.ts:204`; `database.svelte.ts:993` |
| L35 | `mergeServerProjectionCharacterRow` drops hydrated `hypaV3Data` for chats whose live messages all summarized away (carry-over gated on `priorMessage.length > 0`) | `database.svelte.ts:821` |
| L36 | `prereroll.ts` module maps grow unbounded — one full-response string retained per generation for the page session | `process/prereroll.ts:1-29`; caller `orchestrateResponse.ts:119/:173` |
| L37 | `changeLanguage` deep-clones + deep-merges the entire English language pack on every `setDatabase`/projection apply, with no same-language early-return (one-line cache fixes all callers) | `src/lang/index.ts:12-24`; callers `database.svelte.ts:785/:791` |

### Client — render / parse

| ID | Title | Location |
| -- | ----- | -------- |
| L38 | Stray `console.log` of the full expanded `{{#function}}` body and of the resolved function object on every `{{call::}}` during message parsing | `src/ts/parser/risuChatParser.ts:660/:691` |
| L39 | `parseThoughtsAndTools` walks every message char-by-char allocating a 10-char `.slice` per index on every `ParseMarkdown` (no `includes()` fast path) | `src/ts/parser/parser.svelte.ts:797`, called at `:852` |
| L40 | `ChatBody` re-runs full `ParseMarkdown` with no content-keyed memo (`lastChatId`/`lastCharArg` only guard translate-detection; any fix must be module-level — instance state dies on the H3 remount) | `ChatBody.svelte:259/:79/:166` |
| L41 | Per-visible-message document-level `mousemove` listeners (with a rect-scanning fallback) when block/drag partial-edit is enabled — hoist to one shared chat-container handler | `ChatScreens/PartialEditController.svelte:434/:476/:513`; `Chat.svelte:723` |

### Client — UI components

| ID | Title | Location |
| -- | ----- | -------- |
| L42 | GridCatalog re-scans the full character corpus per keystroke and per render (template-call, not `$derived`; ≥2× on grid/list/trash tabs) | `src/lib/Others/GridCatalog.svelte:24/:118/:126` |
| L43 | ModuleSettings filters+sorts all modules inline (unmemoized, unkeyed each) per keystroke in the module search | `Setting/Pages/Module/ModuleSettings.svelte:48/:76` |
| L44 | Sidebar character-list effect rebuilds the whole list and deep-compares via lodash `isEqual` per character-metadata action | `SideBars/Sidebar.svelte:87-133`; `util.ts:215` |

### Client — lifecycle / network

| ID | Title | Location |
| -- | ----- | -------- |
| L45 | SSE command-event client reconnects on a fixed 1 s delay with no exponential backoff or jitter (1 req/s for the whole outage; `replay-unavailable` additionally forces a full resync) | `src/ts/bootstrap.ts:271/:235/:78` |
| L46 | MCP per-client `sseIdDone` Set grows unbounded for the life of the legacy SSE fallback connection (one entry per inbound message incl. pings) | `process/mcp/mcplib.ts:92/:224/:237` |
| L47 | `fetchNative` logs the full request body on every call (script `request()`, image gen, MCP — bodies can carry OAuth tokens) | `globalApi.svelte.ts:1278` |

### Client — translate / TTS / files / MCP (opt-in subsystems)

| ID | Title | Location |
| -- | ----- | -------- |
| L48 | HuggingFace TTS 503 retry loop re-translates the already-translated text each iteration and has no retry cap on a server-controlled sleep | `process/tts.ts:273-298` |
| L49 | `writeInlayImage` awaits `onload` with no `onerror` and no `complete` check — a broken image hangs the inlay write forever | `process/files/inlays.ts:136-164` |
| L50 | `blobUrlCache` never revokes or evicts object URLs — one pinned Blob per distinct inlay id rendered, for the page lifetime | `parser/parser.svelte.ts:743/:757` |
| L51 | PNG card import decodes the whole file twice (asset-count pass + read pass), slicing every asset chunk's full value both times, just for a progress percentage | `characterCards.ts:213/:225`; `pngChunk.ts:207` |
| L52 | Stray `console.log`s in the file-send path (per-`.po`-line index log is live; PDF/XML payload logs are dead on the default picker but live with `allowAllExtentionFiles`) | `process/files/multisend.ts:25/:126/:137/:155/:177/:244` |
| L53 | `postChatFile` `'pdf'` case passes UTF-8-decoded binary into pdfjs, corrupting the document (reachable with the `allowAllExtentionFiles` setting; otherwise latent) | `process/files/multisend.ts:112/:260-263`; `util.ts:339` |
| L54 | MCP `request()` SSE-resolution path leaks a document-level `mcp-sse` listener + unresolved promise per response that never arrives (distinct from the dead customTransport branch) | `process/mcp/mcplib.ts:341-356/:418-434` |
| L55 | Internal MCP clients rebuild their full tool-schema literals on every `getToolList`, and `callMCPTool` re-lists every MCP per tool dispatch (cache the static arrays; index name→client once) | `process/mcp/filesystemclient.ts:41`; `googlesearchclient.ts:63`; `mcp.ts:189/:214` |
| L56 | Toggling module sets destroys/recreates internal MCP clients, re-triggering the FileSystem directory picker on next use (persist the handle; GoogleSearch credential-init is dead in this runtime) | `process/mcp/mcp.ts:140-145`; `filesystemclient.ts:15-31` |
| L57 | Unconditional `console.log` of every MCP SSE frame and of full tools/list responses (the constructor's `debug` arg is accepted but never stored — wire it up) | `process/mcp/mcplib.ts:185/:830`; `mcp.ts:272` |
| L58 | `translateSuggest` has no concurrency/epoch guard and reads live `suggestMessages` mid-loop — overlapping runs tear the translated-suggestions array (the file's existing `suggestionRequestId` epoch just isn't wired into it) | `ChatScreens/Suggestion.svelte:152-171` |
| L59 | `markParsing` retries re-run the full `translateHTML` + `ParseMarkdown` pipeline 4 total times on persistent translation errors (only google/bergamot actually throw; distinguish network from parse failures) | `ChatScreens/ChatBody.svelte:171-179` |

---

## Informational Findings

Real, verified, and worth recording, but below the low bar after calibration
(bounded cost, narrow trigger, or design-note status). Recorded so they are
neither lost nor over-weighted.

| ID | Title | Location |
| -- | ----- | -------- |
| I1 | Reattach to a done in-grace durable job destroys it on first viewer; a second concurrent reattach 404s (single-viewer-at-a-time semantics) | `routes/generationChat.ts:1096`; `streamJobs.ts:332` |
| I2 | `getModuleTriggers` rebuilt (cloning every module trigger) per edit-hook context build, ~5+ sites per send (`getActiveModules` is memoized; this layer is not) | `prompt/assemble.ts:1301`; `prompt/modules.ts:133` |
| I3 | `idx_command_events_created_at` is never queried — pure write-amplification per command-event insert | `db.ts:396/:431` |
| I4 | SSE replay reads + maps the entire `command_events` table per cursored reconnect, then filters (a `WHERE revision > ?` slice must preserve the gap-detection contract) | `routes/events.ts:80`; `commands/events.ts:39/:126` |
| I5 | `inflateBounded` holds chunk list + concatenated result simultaneously (~2× expanded size peak) for legitimate within-cap payloads | `risuSave/boundedInflate.ts:42-62` |
| I6 | Bedrock SigV4 hashes the full request body synchronously on the event loop per request (canonical-request hash is header-bounded, not a second body pass) | `generation/sigv4.ts:116`; `bedrock.ts:172` |
| I7 | SSE partial-event accumulation is O(buflen²/chunk) while a delimiter-free event grows (bounded by the 8 MB cap; degenerate-upstream only) | `generation/sse.ts:23`; adapters openai/anthropic/gemini/mistral/ollama |
| I8 | Horde poll loop: fixed interval, no jitter; poll interval/timeout are client-controllable on a route no live SPA path exercises | `generation/horde.ts:87/:93/:245` |
| I9 | Vertex token-exchange error embeds the raw upstream body in the user-facing error (self-host: same-user only) | `generation/vertexAuth.ts:151` |
| I10 | `collectServerInlayAssetRefs` regex-scans the whole transcript per server send (linear, marker-free common case) | `serverBackedSendChat.ts:138-161/:213` |
| I11 | `evaluateIgp` appends the raw `requestChatData` response object to the last message — literal `'[object Object]'` (preserved verbatim from the original; IGP path) | `process/postGeneration/igp.ts:17-26` |
| I12 | `ParseMarkdown` parses additional assets twice when an editdisplay script changes the text (single-message scale, cached file resolution) | `parser/parser.svelte.ts:834/:844-848` |
| I13 | RegexList renders script rows with an unkeyed `each` + index-based bind/splice (DOM churn on remove/reorder; no data corruption — Svelte 5 re-evaluates the bind) | `SideBars/Scripts/RegexList.svelte:76-84` |
| I14 | BookmarkList rebuilds a full message-spread Map on every message-array change while the modal is open (O(messages-in-chat), incl. streaming appends) | `Others/BookmarkList.svelte:30/:44` |
| I15 | `claudeObserver` arms a 20 s `setInterval` that is never cleared and a one-shot run guard that never resets (self-limits its fetches; still a permanent timer) | `observer.svelte.ts:115/:128/:161` |
| I16 | `risuChatParser` nesting stack is a fixed `Uint8Array(512)`; >512 nesting depth silently mis-parses (OOB typed-array writes are dropped); the `commentV` twin stack is dead code | `parser/risuChatParser.ts:483/:497` |
| I17 | `voiceDetector` would leak its interval, mic MediaStream tracks, and AudioContext — but is dead code (no export, no importer); delete or fix before reuse | `src/ts/voice.ts:1/:13/:30` |
| I18 | `callMCPTool` resolves tool names by first-match across all MCPs — duplicate tool names dispatch to whichever server enumerates first (the `mcpURL` tag from `getMCPTools` is discarded at dispatch) | `process/mcp/mcp.ts:210-226` |

---

## Known-Item Overlaps

These 12 candidates were independently rediscovered and verified live, but
they are the same issues already tracked as v1 findings, gated items, or
`leftover.md` evidence gates. Listed with their disposition so they are not
re-reported as new — with one priority exception flagged first.

| Candidate | Known item | Sev | Disposition |
| --------- | ---------- | --- | ----------- |
| **Every durable generation finalization does a full-corpus `loadPersisted` + linear chat scan** — `persistServerGenerationResult` → `applyTargetedCommandMutation` never sets `chatScopedRead`, so the Phase 2 scoped read (`loadPersistedForChatMutation`) is bypassed on the per-message finalization path (`generationChat.ts:1185`; `mutations.ts:166-168`) | `v1-L6` family | Med | **Recommend scheduling.** This is the per-generation hot path; v1-L6 is marked DONE but its narrowing never reached this caller. The fix is wiring `chatScopedRead` (with the var-write broad case kept), not new machinery. |
| Generation persistence with chat-variable writes rewrites characters+collections+settings tables (`generationChat.ts:525/:531`; `mutations.ts:179-184`) | `v1-L4` | Low | Stays gated (accepted assembly-persist breadth) unless metrics say otherwise. |
| Render-path full re-tokenize in `finalizeRequestBudget` after history+preflight already tokenized the same rows (`budgetFinalize.ts:53-56`) | leftover (prompt-construction narrowing gate) | Low | Evidence-gated; note it discards all prior per-row token bookkeeping. |
| Bootstrap loads the full message-free corpus + masks per page load (`bootstrap.ts:31`; `repository.ts:1227`) | leftover (bootstrap narrowing gate) | Low | Evidence-gated. |
| One long batch (≤32 serialized provider calls, `summarizationMaxConcurrent=1`) blocks all other chats' memory jobs for the batch duration (`memoryWorker.ts:146/:177`) | `v1-L17` | Info | The landed fix is between-batch fairness by design; within-batch blocking is the accepted residual. |
| Asset GC still deserializes the whole character corpus every 15 min (`assetGc.ts:89-95` → `loadPersisted`) — the Phase 5 fix moved the *message* scan to a token scan; the character/chat JSON parse remains | `v1-M10` residual | Low | Worth folding into any future `loadPersisted` narrowing slice. |
| SSE reconnect replays missed foreign events one-at-a-time, each fetched serially; `characters`-fields events force-rehydrate the active chat repeatedly (`bootstrap.ts:304-326`) | `v1-U2` | Info | Stays on the U2 evidence gate. |
| Server-chat token stream re-accumulates + re-enqueues the full response string per token (`serverChat.ts:409-413`) | `v1-H3` sub-component | Info | The landed coalescer bounds the expensive parse; the O(L²) string allocation feeding it was explicitly cited in v1-H3 and accepted. |
| `editdisplay` Lua + display triggers run BEFORE the `processScriptCache` lookup, so the cache never shields per-render trigger cost (`scripts.ts:154-188`) | `v1-H3`-adjacent | Low | Real ordering nit; becomes moot if H3's remount fix lands (the cache wipe dominates). |
| Lorebook entry edits clone the whole collection per keystroke (`LoreBookList.svelte:61-81`) | `v1-L32` residual | Low | The v1 fix scoped the watcher; the editor's per-keystroke collection clone survives. |
| Non-durable generation hard-aborts at a fixed 600 s wall-clock with no activity reset (`requestAbort.ts:28`) | `v1-M8` design note | Low | Same design decision as L1; fix both together if the deadline becomes sliding/configurable. |
| Inlay render re-fetches full asset bytes from the server on every message render — `readServerAsset` has no client cache and the `blobUrlCache` check happens after the fetch (`parser.svelte.ts:754`; `server/assets.ts:115`; `inlays.ts:293`) | leftover (asset-fanout gate) | Low | Evidence-gated, but note the cache-after-fetch ordering makes the existing blob cache ineffective for bytes — a cheap ordering fix may be justified without the full gate. |

## Investigated And Dismissed

Verified not to be live issues by adversarial verification. Listed so they are
not re-opened without new evidence.

1. **Durable submission lock leaks if `attachGenerationViewer` throws after
   register** — structurally plausible (register precedes attach with no
   try/catch) but no synchronous throw site exists between `register` and
   `trackRunner` in current code.
2. **`promptScope` races under concurrent assemblies** — false: the scope is
   set, used, and cleared synchronously inside `expandVariables`
   (`variables.ts:81-101`); `risuChatParser` is synchronous, so no await
   boundary interleaves while the scope is held.
3. **`LuaExecBudget` straddles the provider call, starving post-gen Lua** —
   false: `usedMs` accumulates only actual Lua run wall-clock
   (`luaRuntime.ts:1450`), not time elapsed between phases.
4. **Fresh-engine Lua boot failure crashes the route** — false: both live
   entry points wrap `assemblePromptWithMetrics` in try/catch; a boot failure
   surfaces as a handled assembly error.
5. **Memory selection eagerly decodes every embedding blob per generation** —
   not live as claimed: the only non-test caller wires
   `loadPromptMemoryQueryVectors: () => []` (extends the v1 dismissal of the
   cosine-ranking candidate).
6. **Embedding rate limiter not shared across handlers** — false for the live
   wiring: batch handlers are dispatched exclusively (`if (batchHandler)
   …return`), one worker instance, one limiter in play.
7. **Streaming SSE adapters cap only the residual buffer, letting one huge
   complete event through** — unreachable: an event of size S must first
   accumulate S delimiter-free bytes, tripping the 8 MB cap before it can be
   popped whole.
8. **SSE reader keeps draining the network after a non-abort stream cancel**
   — the specific trigger (consumer `reader.cancel()` without abort on the
   server-dispatch path) is unreachable on the live runtime.
9. **Phase-7 regex memo wiped on every GUI reload, defeating it (standalone
   claim)** — overstated as filed (the `bestMatchCache` part was wrong; the
   render path's true cost shape is H3): tracked via H3, not as its own
   finding.
10. **Memory-worker fairness `now` skew / tiebreak re-skew** — mechanically
    true, no consequential unfairness under the live single-worker wiring.
11. **MCP `customTransport` listener leak** — dead code: `customTransport` is
    never assigned anywhere in the repo (the live SSE-path leak is L54).
12. **PNG-card import uploads all decoded assets as one giant JSON body** —
    false: `saveAssets` chunks uploads at 32 items / 32 MB per batch
    (`chunkServerAssetUploads`).
13. **`getInlayAsset` re-fetches + re-encodes per prompt assembly** — dead
    path: it lives in the local-assembly arm, which `resolveServerPromptAssembly`
    never selects on the live runtime.

## Relationship To Prior Workstreams And Gated Items

- All v1 scheduled fixes were re-verified as present and effective; none
  regressed outright. The regression review surfaced one semantic change
  shipped inside a fix (L22, contextual embedding window fragmentation from
  the `v1-M7` batching) and several *residuals* where a landed pattern was
  applied asymmetrically: M2 (`v1-L2` guard missing from the history walk),
  M5 (`v1-M3` read narrowing missing from single-row PATCH), L32 (`v1-M12`
  deferred cases), L20 (`v1-L16` guard only covers zero-summary chats), and
  the durable-finalization `chatScopedRead` gap (`v1-L6` family — see
  Known-Item Overlaps; recommended for scheduling).
- Gated items stay gated: `v1-L4` (re-confirmed, low), `v1-L7`, `v1-L26`,
  `v1-U2` (re-confirmed, info). **H2 (chat-create) is explicitly NOT part of
  the `v1-L7` gate** — it uses the strictly heavier hydrated mutation path
  and must not hide behind that deferral.
- The round-2 critic identified the CBS/`risuChatParser` interpreter and the
  translate/TTS/files/MCP client subsystems as structural blind spots of both
  audits' round-1 scoping; they account for most of the new medium findings.

## Suggested Remediation Order

1. **H2** — route chat-create through the fork-route kit writers; removes the
   worst routine-action corpus-scaling stall. Pair with L13 (Realm import,
   same path) and the durable-finalization `chatScopedRead` wiring
   (Known-Item Overlaps, `v1-L6` family).
2. **H3** — decouple `ReloadGUIPointer` from whole-screen remounts and stop
   wiping the script/regex caches on var-only changes; L40 and M17 largely
   collapse into it.
3. **H1** — signal + budget + iteration caps for the V2 trigger interpreter
   (mirror `LuaExecBudget`).
4. **Assembly CBS slice** — M1 (dirty-flag the capture/clones), M2
   (fixed-point guard in the history walk), M3 (render-once template cards),
   M4 (memoize history/lore callbacks), plus L8/L9 — one coherent slice over
   `assemble.ts`/`history.ts`/`templates.ts`.
5. **Server read-narrowing ring 2** — M5 (scoped single-row PATCH reads,
   modules-aware), M6 (field-scoped projection loaders), L3.
6. **Client clone-narrowing ring 2** — M7 (drop the redundant `replace_all`
   clone — one line), M8 (one line), M9, M10, L33, L37.
7. **Bridge echo guards** — M11, M12 (same epoch-gate pattern as siblings).
8. **Stability one-liners in opt-in subsystems** — M21 (parens + streaming
   cap), M19 (catch the chain), M18 (reuse one AudioContext), M22 (remove the
   test cap), M16 (remove log + extend `DoingChat` gate), M15 (Map + LRU),
   M20 (MCP deadlines), M14 (idempotent `nodeObserve`).
9. Low-severity batches by area as touched; L15 (`PRAGMA synchronous =
   NORMAL`) and L45 (reconnect backoff) are cheap standalone wins.

## How To Reproduce / Verify

- Server stage timings: `RISU_PROTOCOL_METRICS=1`; watch `databaseLoad*`,
  `projection_response`, and the prompt-construction stage splits for the M1-M4
  costs; chat-create (H2) shows up directly in command-mutation timing.
- Offline corpus cost: `pnpm analyze:db <input>` for corpus-scale estimates
  (the M5 measurements above used the 50-character/6.85 MB reference DB).
- Client render cost (H3/M13-M17): profile while firing a `/trigger` command
  or `{{v2UpdateGUI}}` effect and watch `ParseMarkdown`/`risuChatParser`
  self-time across all visible messages; toggle auto-translate to expose
  M15/M16.
- Type/test gates after any fix: `pnpm test`, `pnpm api:test`,
  `pnpm client-thinning:audit`, and the two project-reference TypeScript
  checks (`tsc -p tsconfig.client-lib.json`;
  `tsc -p server/fastify/tsconfig.json --noEmit`).
