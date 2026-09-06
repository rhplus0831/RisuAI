# Brief A — Prompt assembly & request payload (CLAUDE track)

Auditor: Claude track, dual-track blind discovery, 2026-08-12.
Delta audited: `f2dc174f4..HEAD` (177 commits). Baseline:
`/home/codex/risu-baseline-71c476e9c` (`71c476e9c`).
Method: full review of the delta diff over `server/fastify/src/prompt/`,
`server/fastify/src/generation/`, `server/fastify/src/routes/generationChat.ts`,
and the client send path, cross-read against the baseline worktree and (for
ported units) the upstream spec commits, which are present in the local object
store and were diffed directly.

---

## A-1 — Non-Hypa context-truncation confirmation gate replaces the fork point's silent trim [med]

- **Current:** `server/fastify/src/routes/generationChat.ts:5155-5187` — when
  preflight marks `hypaContextTruncationCheckRequired`
  (`generationChat.ts:1049-1052`: persisting mode, not (db.hypaV3 &&
  char.supaMemory), chat not yet acknowledged) and the client advertises the
  `hypaContextTruncationConfirmation` capability, the route assembles the
  prompt up front and, if a durable chat row was dropped by either budget pass
  (`assemblyRequiresHypaContextTruncationConfirmation`,
  `generationChat.ts:1370-1381`; flag produced at
  `server/fastify/src/prompt/memory.ts:59-77,117` and
  `server/fastify/src/prompt/budgetFinalize.ts:61-71,93`), returns 409
  `hypa_context_truncation_confirmation_required` instead of dispatching. The
  client shows a confirm dialog, persists a per-chat
  `hypaContextTruncationAcknowledged` flag, and retries
  (`src/ts/process/serverBackedSendChat.ts:488-512`, ack write at `:171-197`).
- **Baseline:** `src/ts/process/index.svelte.ts:1005` gates memory; without an
  active memory system the generic trim loop drops the oldest removable rows
  and dispatches immediately — no prompt, no persisted flag (trim loop
  semantics mirrored by the fork's `buildMemoryWindow`/`finalizeRequestBudget`).
- **User-visible consequence / repro:** non-Hypa character, history larger than
  `maxContext`, press send. Fork point: request goes out at once with older
  rows silently omitted. Current: generation halts on a confirmation dialog
  the first time in each chat; declining aborts the send entirely (an outcome
  the fork point could not produce); accepting persists a new per-chat field
  (export-shape overlap with brief F) and retries.
- **Notes:** the trim *boundary* itself is unchanged — after acknowledgement
  the same rows are dropped in the same order. The gate is capability-gated,
  so old clients keep exact fork-point behavior. Implementation is clean: the
  up-front assembly is reused for the dispatch (`preparedAssembly` threaded at
  `generationChat.ts:5206,5225`), and the 409 path persists nothing (mutation
  persistence is command-based via `persistAssemblyMutations`,
  `generationChat.ts:1498`, never reached on the 409 return), so triggers/CBS
  side effects do not double-run across the confirm-retry cycle.
- **Provenance:** fork-original feature (`656be4b1e`, no `Ported-from`), not in
  ADJUDICATION.md, not in any archived intentional section.
- **Charter classification:** `decide` (deliberate, arguably better UX, but a
  new user-visible pre-generation modal + persisted chat field vs. fork-point
  silence — needs an individual sign-off).
- **Confidence:** high.

## A-2 — Continue with a non-empty composer no longer sends (or consumes) the typed text [med]

- **Current:** `src/lib/ChatScreens/DefaultChatScreen.svelte:1647-1669` — the
  entire user-message build is guarded by `if (!continueResponse)`; composer
  clearing is likewise guarded (`:1722-1724`). Clicking menu → Continue
  (`sendContinue`, `:1379-1381`; enabled whenever the last row is `char`,
  `:386` — the composer content is not part of the gate, `:3040`) with text in
  the composer sends `mode: 'continue'` with no user row; the server then
  builds the continue payload from stored history plus (with
  `useSayNothing: true`) the transient `*says nothing*` boundary
  (`server/fastify/src/prompt/assemble.ts:755-770`). The typed text never
  reaches the payload and stays in the composer.
- **Baseline:** `src/lib/ChatScreens/DefaultChatScreen.svelte:139-213`
  (`@71c476e9c`) — `sendMain(true)` has no continue guard around the message
  push: non-empty `messageInput` runs the input trigger, is `editinput`-
  processed, and is pushed as a persistent user row (`:183-206`), the composer
  is cleared (`:207`), and `sendChatMain(true)` proceeds. The payload ends
  with that user-text row (no says-nothing), and on completion the row is
  replaced by a char row whose text is `editoutput(userText + completion)`
  (`src/ts/process/index.svelte.ts:1636-1648`).
- **User-visible consequence / repro:** type "and then?" into the composer,
  open the menu, click Continue. Fork point: the request contains a trailing
  `user: and then?` row, and the transcript ends with one merged char row
  containing the typed text plus the continuation. Current: the request ends
  with `user: *says nothing*` (or the previous char row in extend mode), the
  reply is a plain continuation, and "and then?" is still sitting in the
  composer. Divergent payload, divergent output, divergent transcript.
- **Provenance:** the client-side guard predates the delta (present at
  `f2dc174f4`, same lines), but `8bf88e43c` (in-delta) rewrote continue
  semantics under the claim of restoring legacy continue-writing
  compatibility and did not cover this sub-case; the archived PA doc lists
  "continue-mode history construction" under *areas verified clean*, and
  neither ADJUDICATION.md nor any intentional section records it — so it is a
  gap exposed by the delta's compatibility restoration, not an adjudicated
  divergence.
- **Charter classification:** `decide`. The baseline behavior is a footgun
  (typed text gets swallowed into the merged reply), but the charter bar is
  fork-point parity; restoring it is feasible with the same disposition
  plumbing `8bf88e43c` added.
- **Confidence:** high on the mechanism (both sides code-verified); high on
  non-adjudication (ADJUDICATION.md and the three area docs checked).

## A-3 — Append-mode continue boundary is transient; the fork point persisted it before dispatch and kept it on failure [low]

- **Current:** `server/fastify/src/prompt/assemble.ts:759-770` — the
  `*says nothing*` boundary row is pushed only into the working
  copy (`transientContinueBoundaryId`), explicitly excluded from every
  persistence surface (`persistentMessageRows`, `assemble.ts:836-840`; inject
  filtering `:1891-1893`; submit capture `:1436`), and replaced in-memory by
  the final assistant row (`:2742-2751`). If generation fails or is cancelled,
  the durable transcript never contained it.
- **Baseline:** `src/lib/ChatScreens/DefaultChatScreen.svelte:170-181,209`
  (`@71c476e9c`) — the says-nothing user row was pushed into the live chat
  *before* `sendChatMain`, i.e. persisted. On success it was overwritten by
  the char row (`index.svelte.ts:1636-1648`); on failure/cancel it remained a
  durable trailing user row.
- **Payload consequence / repro:** `useSayNothing: true`, click Continue, kill
  the provider (network error). Fork point: transcript now ends with a
  `*says nothing*` user row; the next empty-composer send does *not* add
  another says-nothing (last row is already user, `:172`) and is a plain send
  whose payload carries the stale says-nothing row and **no**
  `[Continue the last response]` marker; the Continue menu item is disabled
  (last row not char). Current: transcript is unchanged, Continue stays
  available, and the retry is a clean continue payload with a fresh boundary
  and the marker. Same user actions, different payload sequence and different
  transcript.
- **Provenance:** deliberate in `8bf88e43c` ("keep the legacy say-nothing
  boundary transient") — but the CA-OR-7 `resolved` row in ADJUDICATION.md
  describes only the append-vs-extend disposition, not the failure-path
  retention divergence, so this specific residue is unadjudicated.
- **Charter classification:** `decide` (retaining a junk user row on failure is
  hard to defend, but it is fork-point behavior and observable on surfaces 1
  and 2). Overlaps brief B; reported here for the payload sequence.
- **Minor note (invisible, not graded):** the boundary row carries
  `name: database.username` and a UUID `chatId` where the baseline row had
  `name: null` and no `chatId` (`assemble.ts:760-766` vs. baseline
  `DefaultChatScreen.svelte:174-178`); neither field reaches the outgoing
  payload (`server/fastify/src/prompt/history.ts:358-366`) nor Lua's
  `getFullChat` projection (role/data/time only), so no reachable divergence
  was found.
- **Confidence:** high.

## A-4 — CA-DF-1's description no longer matches current code (browser-context CBS moved twice in the delta) [low — adjudication update, not a new divergence]

- **Current:** `server/fastify/src/prompt/cbsAdapter.ts:75-93,149-151` —
  `{{screenwidth}}` and `{{metadata::browserlanguage}}` now resolve from a
  client-reported context snapshot
  (`src/ts/process/request/clientContext.ts:32-60`, sent per request at
  `src/ts/process/request/serverChat.ts:417`), restoring fork-point parity for
  those two. `{{screenheight}}` deliberately returns an **empty string** plus
  a diagnostic warning (`cbsAdapter.ts:90-93`).
- **Baseline:** `src/ts/cbs.ts:446,517,1890` (`@71c476e9c`) — all three
  resolved from live `window`/`navigator`.
- **Why this is reportable:** CA-DF-1 ("browser-context CBS … unresolved or
  uses server locality; `67210c623` made the gap explicit with notices") is
  now stale in both directions: screenwidth/browserlanguage are *resolved*
  (not deferred), while `{{screenheight}}` changed behavior inside the delta
  from "throws → directive preserved literally" to "empty string" — a third
  behavior distinct from both the fork point (a number) and the state the
  deferral described. Repro: card containing `{{screenheight}}px` — baseline
  sends e.g. `1080px`; pre-delta fork sent the literal `{{screenheight}}px`;
  current sends `px`.
- **Charter classification:** `decide` scoped to `{{screenheight}}` only
  (either resolve it from the same reported context — the client already
  reports width, height is one field away — or re-record the deferral with
  the empty-string behavior). Date/time CBS in server locale remains as
  CA-DF-1 describes.
- **Confidence:** high.

## A-5 — Legacy Kobold endpoint joining diverges from the fork point's pass-through [low]

- **Current:** `server/fastify/src/generation/kobold.ts:78-94` (rewritten
  in-delta by `59f4b3552`) — segment-aware join: appends the missing tail of
  `api/v1/generate` to whatever path is configured (`/api/v1` →
  `/api/v1/generate`; bare host → `/api/v1/generate`; `/proxy/generate` →
  `/proxy/generate/api/v1/generate`).
- **Baseline:** `src/ts/process/request/request.ts:959-962` (`@71c476e9c`) —
  only a bare host (`pathname.length < 3`) got `api/v1/generate`; any other
  configured path was used **as-is**.
- **User-visible consequence / repro:** `koboldURL =
  http://host/proxy/generate` (a proxy exposing a Kobold-compatible generate
  endpoint at that exact path). Fork point: POST to `/proxy/generate` —
  works. Current: POST to `/proxy/generate/api/v1/generate` — breaks.
  Conversely `koboldURL = http://host:5001/api/v1`: fork point posts to
  `/api/v1` (a non-endpoint, request fails); current posts to the working
  `/api/v1/generate`.
- **Provenance/scope note:** the always-append behavior for non-matching paths
  predates the delta (pre-delta fork appended `/api/v1/generate` whenever the
  literal substring was absent); the delta changed the duplicate-suffix case
  and rewrote the joiner wholesale, so the divergence class persists through
  an in-delta rewrite. Not recorded in ADJUDICATION.md or the archived
  provider doc's intentional sections.
- **Charter classification:** `decide` (baseline pass-through breaks the
  common `/api/v1` misconfiguration the fix targets; parity restoration would
  re-break it; a middle path is appending only for bare hosts, exactly as the
  baseline did).
- **Confidence:** high on behavior; medium on user impact (legacy transport).

---

## Areas swept and found clean (explicit)

- **`f6df8cb1e` CBS-before-lorebook-token-count** — upstream port
  (`80ad19ce9` #1490); reference is the ported spec, not the fork point.
  Verified faithful: the browser-side change is line-equivalent to the
  upstream diff; the server counts the CBS-evaluated, decorator-stripped text
  with `runVar: false` (`server/fastify/src/prompt/lorebook.ts:183-193`,
  call sites `:879,:1236`) so cutoff preflight cannot fire variable writes;
  the `isRisuChatParserFixedPoint` fast path
  (`server/fastify/src/prompt/parserFixedPoint.ts:8-10`) only skips
  evaluation for text the parser provably leaves unchanged. Activation/key
  matching untouched; inserted prompt text remains the raw source, matching
  upstream.
- **`6c361e00e` prompt-block role selection (`role2`)** — upstream port
  (#1515 net of the lorebook-role revert). No leak into non-opted-in
  templates: absent `role2` is a strict no-op
  (`src/ts/process/promptBlockRole.ts:5`), normalization matches upstream
  `e5611f200` exactly (`src/ts/process/promptTemplateNormalization.ts:29-57`
  — `role2` only normalized when present), rows are structured-cloned before
  the role is applied (`server/fastify/src/prompt/templates.ts:445-462,616`),
  and the description role is applied to the base description row only via
  `descriptionBaseIndex` computed after lorebook placement
  (`server/fastify/src/prompt/assemble.ts:1717-1719`), mirroring upstream's
  `getDescriptionPrompts`; `buildDescription` always returns exactly one row
  (`server/fastify/src/prompt/staticSections.ts:43-57`), so the base index is
  always defined on the live path and the `?? 0` fallback in
  `applyDescriptionPromptRole` is unreachable there.
- **`c47b662fa` empty system-role replacement → `user`** — matches upstream
  #1526 byte-for-byte on the browser path; the server arm adds only its
  pre-existing value validation (`server/fastify/src/prompt/chatDispatch.ts:651`).
- **`16842f066` CBS `{{reverse}}` + `setdefaultvar` 'null' sentinel** —
  upstream port (#1461). Side benefit: this **satisfies the "verify current
  upstream also fixed it" condition on the CA-HC-1 keep row** — upstream did
  fix the `"null"`-sentinel defeat, so the fork's `setdefaultvar` behavior is
  now upstream-aligned, not merely saner-than-baseline.
- **`8bf88e43c` payload construction** (beyond A-2/A-3): boundary content,
  position, and role match the baseline says-nothing row for every
  UI-reachable case; the continue-button gate is identical on both sides
  (current `DefaultChatScreen.svelte:386` vs. baseline `:908-910`: length ≥ 2
  and last row `char`), the fork has no auto-continue
  (`autoContinueChat` removed — CA-OR-10, `decide` queue) and no continue
  chat-command, so the server's unconditional boundary push
  (vs. the baseline's last-row-not-user guard) has no reachable divergent
  input; `[Continue the last response]` model gating matches the baseline
  prefix list (`server/fastify/src/prompt/templates.ts:712-719` vs. baseline
  `index.svelte.ts:1165-1170`); extend-mode history construction is unchanged
  and matches the baseline `useSayNothing: false` shape; the mutation
  checkpoint is cloned *before* the boundary push (`assemble.ts:754` vs.
  `:759`), so no phantom transcript mutations; `useSayNothing` defaults to
  `true` server-side (`server/fastify/src/databaseDefaults.ts:286`), matching
  the baseline default, so existing server DBs get append mode (the
  new-scalar-hydration trap does not bite).
- **Protocol waves (`43247b49e`..`b14da1985`) + MTC fixes** — no payload
  perturbation found in `server/fastify/src/prompt/`: wave diffs touch
  `sseEvents.ts` (wire, out of scope), `providerTransport.ts` (frame
  metadata/token-throughput telemetry), and memory-job notification wiring
  (`ecf470b04`); the truncation preflight's up-front assembly is reused for
  dispatch on both durable and stream paths (single assembly per generation).
- **Sampler parameters** — `reasoningEffort` remap (`b47cf3028`,
  ported model-catalog family) *improves* fork-point parity: −1/0/1/2 map
  identically and out-of-range now falls back to `medium` exactly like the
  baseline `getEffort` default (`server/fastify/src/prompt/chatDispatch.ts:203-216`
  vs. baseline `src/ts/process/request/shared.ts:136-154`); the pre-delta code
  sent `xhigh` for ≥3 and `minimal` for <−1. New capability flags
  (`reasoning_effort_none`/`_xhigh`/`_min_medium`, `noStructuredOutput`,
  Gemini `thinkingLevel`) exist only on post-fork models. `verbosity` default
  `1` (`chatDispatch.ts:368`) restores the baseline preset default. OpenAI
  flex (`6553ba922`, port) and additional-params-to-all (`c5fba5560`, port)
  are default-off with profile rows preserved
  (`server/fastify/src/generation/additionalParams.ts:272-288`).
  Half-streaming (`ba5bd8be5`, fork-original) is a new default-false setting;
  it sets provider `stream: true` when enabled but no fork-point input maps
  to it.
- **`0a43e639d` trigger-var no-op write skip** — value-identical writes only;
  `===` comparison cannot skip a type-changing or sentinel-replacing write
  (`server/fastify/src/prompt/triggerVars.ts:168-194`).
- **`ce5d74b18` input-trigger localLore adoption** — parity-*restoring*
  (baseline trigger lore writes hit the live chat object); same-generation
  lorebook activation now sees trigger upserts as the baseline did.
- **`67210c623` client-context CBS** — screenwidth/browserlanguage restored
  (see A-4); Lua/trigger CBS fields thread the same context.
- **Misc**: `e1ac763da` (client vocab HTTP caching), `6f8bb981e` (client
  hydration counts), plugin V3 API additions, input-hook/draft-hook features
  (fork-original surfaces), model-catalog additions, `827720c43` Responses
  adapter (ported spec) — no fork-point payload surface touched for
  fork-point inputs.

## Not verified / out of reach

- No live end-to-end payload capture was performed (static code analysis
  only); the Stage-3 golden-transcript harness is the right place to confirm
  A-2/A-3 byte-level payload shapes.
- Upstream reference for half-streaming: assumed fork-original (no
  `Ported-from` trailer, not in the sweep ledger); if it was actually specced
  from an upstream unit I did not find, its reference changes but the
  default-off conclusion stands.
- `openai-responses` adapter internals (`827720c43`) were spot-checked for
  provenance only, not line-diffed against the upstream overhaul; the F3
  ledger rows mark them DONE.
- Durable reattach/epoch edge cases for `continueDisposition` carriage
  (brief D's surface); the assembly-side derivation is deterministic, but I
  did not trace every replay path.
- Group-chat continue and non-server-routable providers: standing no-port
  decisions (CA-OR-2, CA-PR-3), not audited.
