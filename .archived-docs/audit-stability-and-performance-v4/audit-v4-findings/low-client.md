# V4 Audit — Low-Severity Findings: Client (Detail)

Full-detail companion to `../audit-stability-and-performance-v4.md` for the
client low-severity findings (L17-L38). Finding IDs, titles, and severities are
canonical in that document; this file carries the full corrected mechanism, the
verifier corrections, and the complete location anchors for each item. Line
numbers were captured at the audit window (round-1 finders read `4ccc15194`;
verification re-checked against the working tree between `18cc05099` and
`b355586a6`) and will drift; the symbol names are the durable anchors. Where a
finder's claim was corrected by verification, the corrected version is stated
and the original claim is noted.

---

### Client — send path

## L17 — Double-send window on the send path (`$doingChat` set after the M4 append round-trip)

- Severity: low · Category: both · Area: client
- Finder: `hostile-client-send-render` (cid C39), claimed high, confidence high
- Verification: confirmed 2-1 (liveness refuted at low, mechanism confirmed at
  medium, severity confirmed at low → calibrated low). The liveness lens
  refuted the headline routine-double-Enter consequence; the mechanism and
  severity lenses confirmed the window exists but is bounded.
- Novelty: extension of v3-M4 (the M4 fast-path widened a pre-existing window;
  it did not introduce it)
- Location: `src/lib/ChatScreens/DefaultChatScreen.svelte` `sendMain` (entry
  guard `if ($doingChat) return` at `:212`, `messageInput=''` synchronous clear
  at `:258`, `await appendCurrentChatUserMessageForSend` at `:261`, trailing
  `sleep(10)` at `:269`, `sendChatMain` at `:272`, send button abort spinner
  gated on `$doingChat` at `:738`); `src/ts/chatCommands.ts`
  `appendCurrentChatUserMessageForSend` (`:710`, synchronous optimistic push at
  `:732`, `await runServerCommand` at `:764`, `rollbackAppend` /
  `removeOptimisticCurrentChatMessage` at `:756-807`); `src/ts/process/index.svelte.ts`
  `sendChat` (`doingChat` get at `:138`, atomic set at `:158`, re-entry loser
  returns false at `:142`); `src/ts/server/commands.ts` `runServerCommand`
  `:2200`; autosuggest re-entry `Suggestion.svelte:304-308`; server append
  concurrency `server/fastify/src/commands/mutations.ts:498-538`,
  `routes/commands.ts:3460`.

**What.** `sendMain` gates re-entry only with `if ($doingChat) return` at entry;
`doingChat` is first set inside `sendChat` (`index.svelte.ts:158`), which is not
reached until after the awaited append at `:261`. During the append round-trip
`$doingChat` is false, the send button still renders "Send" (the abort spinner
is gated on `$doingChat` at `:738`), and the textarea has no disabled/lock
state — so a second Enter, a second click, or an autosuggest click can re-enter
`sendMain` past the still-false guard. The finder framed this as a high
data-correctness defect that the M4 append fast-path *introduced*. Both framings
were corrected:

- NOT a regression. The identical re-entry window existed pre-M4 (tree
  `ad07004ba`): `sendMain` then also gated only on `if ($doingChat) return`, set
  `doingChat` only inside `sendChat`, and did `await sleep(10)` before
  `sendChatMain`. M4 only widened the pre-send await from `sleep(10)` to a
  loopback command round-trip and swapped the persist mechanism from a
  fire-and-forget full-transcript replace to an awaited per-message append.
- The routine plain-text double-Enter does NOT duplicate. `messageInput` is
  cleared synchronously at `:258` and the optimistic user row is pushed
  synchronously at `chatCommands.ts:732` (inside the synchronous
  `withTrustedServerProjectionWrite`) *before* the await. A second Enter
  therefore reads `messageInput === ''` and sees the last row is already role
  `user`, so the empty-input branch (`:237-247`) builds no `userMessage` and
  appends nothing. `sendChat`'s read-check-set of `doingChat` (`:138`/`:158`)
  has no intervening await, so the second send is a clean re-entry loser
  (returns false at `:142`) before any persist or dispatch.
- The server's optimistic-concurrency check provides a second backstop: two
  concurrent appends carrying the same cached `baseRevision` are serialized on
  the single-threaded server; the first commits and bumps the revision, the
  second sees the bumped revision and returns `RevisionMismatchError` (409),
  and the client's `rollbackAppend` splices its duplicate optimistic row back
  out. The dominant real outcome of a rapid double-Enter is one persisted
  message, one correct generation, and a "Server revision conflict" alert for
  the dropped send.

**Impact / trigger.** The only genuine duplicate-append vector is the autosuggest
path (`Suggestion.svelte:304-308` sets a non-empty `messageInput` then calls
`send()`), which is opt-in (`useAutoSuggestions` has no default initializer,
defaults falsy) and also existed identically pre-M4. A genuine double-persist
otherwise requires a sub-10ms timing coincidence: append-1's SSE event must
advance `cachedServerCommandRevision` during the trailing `await sleep(10)`
window before `doingChat` is set, AND a second Enter must land in that same
window. Bounded, infrequent, latent; no corpus/transcript scaling.

**Verifier notes.** "True duplicate persistence needs a sub-10ms
SSE-cache-advance race in the trailing `sleep(10)` window before `doingChat` is
set." In steady state `getServerCommandBaseRevision` is a cached hit
(`commands.ts:986`), so the append round-trip is a single fetch, not the
"first-token revision fetch" the candidate implied. `git log -S
'doingChat.set(true)' -- DefaultChatScreen.svelte` is empty — `sendMain` has
never held a synchronous lock.

**Fix.** Take a synchronous send lock at the very top of `sendMain` before any
await (set `doingChat=true`, or a component-local `sending` flag), clearing it
in a `finally` that also covers the append early-returns at `:262-267`. This
also closes the pre-existing `sleep(10)` window.

## L18 — Cancel-before-first-token leaves the optimistic empty assistant bubble

- Severity: low · Category: stab · Area: client
- Finder: `hostile-client-send-render` (cid C42), claimed low, confidence medium
- Verification: confirmed (lone skeptic, low), scoped to the before-first-token
  case
- Novelty: new (distinct from the `leftover.md` reattached-observer reconcile
  gap — here it is the LOCAL active sender, with no persisted row and no
  reconciling event)
- Location: `src/ts/process/postGeneration/streamResponse.ts:73-83` (optimistic
  empty `{role:'char', data:''}` push for non-continue sends); aborted return
  `src/ts/process/index.svelte.ts:398-400` (returns false before the
  `serverTerminal` await at `:409`/`applyServerBackedTerminal` at `:409-411`);
  orchestrate return `orchestrateResponse.ts:115-117`; partial-persist guard
  `server/fastify/src/routes/generationChat.ts:1715-1727`
  (`persistRawCancelledResult` only when `transportResult.result.length > 0`);
  caller `sendChatCompletion.ts:18`.

**What.** `consumeStreamResponse` unconditionally pushes an empty
`{role:'char', data:''}` row for non-continue sends (send AND regenerate, not
send alone — verifier correction) before any token is read. On a
before-first-token abort, `emitProviderChunks` returns `result:''`, the read
loop exits with `streamAborted`, `orchestrateResponse` returns `aborted`, and
`sendChat` returns false at `:398-400` BEFORE the terminal handling that would
reconcile or remove the row. The verifier scoped this to the empty (zero-token)
case specifically: if at least one token streamed, the durable runner calls
`persistRawCancelledResult` (`generationChat.ts:1715`), which persists the
partial text and emits an origin-free `generation.persisted` command event that
reaches even the canceller as a FOREIGN event (the route passes no
`eventOrigin`, so `isOwnCommandEvent` is false), driving the projection and
reconciling the local row. So the candidate's "empty/partial" title is slightly
too broad — the partial case self-reconciles; only the truly empty case is left
orphaned.

**Impact / trigger.** Cancelling a generation before the first provider token
(stop button during provider-connect/first-token latency) leaves a blank
assistant bubble in the live projection. `doingChat` IS correctly cleared
(`sendChat`'s `finally`), so the UI returns to sendable — a stale-render/reconcile
gap, not a stuck state. In single-user mode no foreign command event fires to
clean it, and re-opening the same chat won't re-hydrate (`hydratedChatIds`
guard, `chatMessageHydration.svelte.ts:61`), so the empty bubble survives
same-chat switching until a reload or unrelated full resync. One blank bubble,
no data loss, no growth.

**Verifier notes.** The mechanism was traced end-to-end on HEAD `b355586a6`. The
local SSE consumer aborts (`reader.cancel` + `iterateSseEvents` stops) and never
processes the server's `done` frame; `cancelDurableOnAbort` issues the DELETE
but the DELETE handler only aborts the job (`generationChat.ts:1896-1909`).

**Fix.** On the aborted orchestrate return for a non-continue server-dispatched
send, remove the optimistically-pushed empty row (find it by
`chatId === generationId` via `findGeneratedAssistantMessage`) before returning,
or trigger a scoped projection re-read of the active chat — keep it inside
`withTrustedServerProjectionWrite`.

## L19 — Every authenticated request re-mints an ES256 JWT (per-call IndexedDB open + ECDSA sign)

- Severity: low · Category: perf · Area: client
- Finder: `client-network-waterfall` (cid C29), claimed medium, confidence high
- Verification: confirmed 3-0 (all three lenses low; calibrated medium → low)
- Novelty: new (no prior auth item covers client-side per-request JWT minting;
  v3-K2 / v2-L16 are server-side double-verify costs)
- Location: `src/ts/storage/fastifyStorage.ts:81` (`getProxyAuth`) → `:48`
  (`createAuth`, `exportKey('jwk')` + ECDSA sign, `exp` = now + 5 min at `:58`)
  → `:90` (`getKeyPair`, regenerate-on-miss); sync `localStorage.setItem` at
  `:84-85`; `FastifyStorage.setItem/getItem/removeItem` also call `createAuth`
  at `:119/138/156/176`; `src/ts/util.ts:1210` (`openKeypairStoreDB`,
  `indexedDB.open('DPoPDB',1)` per call, never closed) / `:1244`
  (`getKeypairStore`); consumers `src/ts/server/commands.ts:2249`
  (`requestCommandJson`), `src/ts/server/projection.ts` (×5),
  `src/ts/server/bootstrap.ts:71`, `src/ts/server/events.ts:78`,
  `src/ts/process/request/serverChat.ts:129/150`.

**What.** `getNodeServerProxyAuth()` — the universal auth-header primitive for
every command POST, projection/hydration GET, bootstrap, generate POST, and
proxied provider fetch — calls `sharedStorage.getProxyAuth()`, which on EVERY
call: (1) opens a fresh `indexedDB.open('DPoPDB',1)` connection (never closed)
and reads the keypair (never held in memory); (2) does
`crypto.subtle.exportKey('jwk')` + `crypto.subtle.sign(ECDSA-SHA256)` plus two
JSON.stringify+base64url passes; (3) does a synchronous
`localStorage.setItem('risuauth', auth)`. The minted JWT is valid 5 minutes but
is discarded and re-minted on the next request. The candidate claimed medium and
cited three amplifiers, two of which were corrected:

- The "bulk hydration pays it 4× (`BULK_HYDRATION_CONCURRENCY=4`)" claim is
  wrong — `fetchServerBulkChatMessages` is a SINGLE POST that mints auth once;
  the concurrency constant does not fan out per chat in the live path.
- Per-asset image DISPLAY does NOT mint auth — `getFileSrc` returns the
  `/api/v1/assets/` URL for the browser `<img>` to fetch directly, so there is
  no per-render image fanout. Only JS byte-reads (inlays, char import, emotion)
  via `readServerAsset` mint.
- The WebCrypto cost is negligible (measured ~0.08-0.117 ms for exportKey+sign);
  the dominant cost is the `indexedDB.open` + read round-trip (single-digit ms
  in a browser) plus the sync main-thread `localStorage.setItem`.

**Impact / trigger.** Fires on every server interaction (every settings/preset/
persona/lorebook/var/append edit, single-chat hydration on open, ~2 mints per
message send — append command then `/generate/chat`, proxied provider fetches,
asset byte-reads). Scales with request count / session activity, NOT with corpus
or transcript size — a constant per-request cost, which is why it fails the
medium bar. The un-closed `IDBDatabase` handles are connection churn, not an
unbounded leak (browsers GC idle IDB connections).

**Verifier notes.** "exportKey+sign measured ~0.085 ms per op"; "the dominant
real cost is the `indexedDB.open('DPoPDB',1)` round-trip + read transaction
... realistically ~2-6 ms in a browser." `checkAuth()` correctly short-circuits
after first success via `this.authChecked`, so steady-state per-call cost is
only `getKeyPair` + `createAuth` + the localStorage write.

**Fix.** Cache the resolved `CryptoKeyPair` in a module/instance field after the
first `getKeyPair()` (the private key is non-extractable). Cache the minted JWT
and reuse it until ~30 s before `exp`, re-signing only near expiry, collapsing
the steady-state cost to a string read; gate the `localStorage.setItem` on a
token change. Optionally hold one open `IDBDatabase` handle.

---

### Client — render / window

## L20 — `screenShot()` sets `loadPages = Infinity`, mounting and parsing the full transcript

- Severity: low · Category: both · Area: client
- Finder: `client-dom-scale` (cid C27), claimed low, confidence high
- Verification: confirmed (lone skeptic, low)
- Novelty: new (no `screenShot`/`loadPages`/`toCanvas` item in v1-v3; the H1
  high-water-mark variant is a sibling v4 candidate, mechanically distinct
  because `loadPages` is restored in `finally` here)
- Location: `src/lib/ChatScreens/DefaultChatScreen.svelte:434-494` (`screenShot`):
  `:437` `loadPages = Infinity`, `:438` `await tick()`, `:444-448` `toCanvas`
  per `.risu-chat` node, `:461-478` merge, `:492` `finally` restore; menu
  trigger `:1136-1138`; window consumer `Chats.svelte:46-89`
  (`loadEnd = messages.length - loadPages`); parse `ChatBody.svelte:394`
  (`markParsing` → `memoizedChatBodyParse`); memo cap
  `ChatBodyParseMemo.ts:31` (`PARSE_MEMO_LIMIT = 180`).

**What.** The screenshot menu action sets `loadPages = Infinity`, awaits a tick
(forcing the entire transcript to mount — every Chat + ChatBody + ParseMarkdown),
then runs `html-to-image` `toCanvas` over every `.risu-chat` node sequentially
and merges the canvases. With `loadPages = Infinity`, `Chats.svelte`'s
`loadEnd = messages.length - loadPages = -Infinity`, so the render loop iterates
every message (no windowing/virtual list). `loadPages` is restored in `finally`
(`:492`), so it does NOT contribute to the H1 high-water-mark — this is the
distinct deliberate-action variant. The verifier sharpened the bound: the
180-entry parse memo does NOT bound the freeze — a chat over 180 messages evicts
as it goes, so every mounted message runs a fresh `ParseMarkdown` and the parse
cost is O(N) regardless of the memo. The `canvases` array also holds all N
rasterized canvases simultaneously through the merge loop, so the in-action peak
is full transcript DOM + N canvases at once.

**Impact / trigger.** Explicit, infrequent menu action (Camera → Screenshot). On
a long chat: a large transient memory/CPU spike that can OOM the tab, unbounded
in transcript length. Opt-in and deliberate, hence low.

**Fix.** Cap or chunk the screenshot — raise `loadPages` incrementally, capture,
and release each canvas before the next; or warn/abort above a message-count
threshold. Reuse the existing `canvases[i].remove()` teardown but bound the
number held at once. The H1 `loadPages`-reset lever bounds this path too.

## L21 — Drag-edit attaches document listeners per in-viewport message (not a leak)

- Severity: low · Category: perf · Area: client
- Finder: `client-dom-scale` (cid C28), claimed low, confidence high
- Verification: confirmed (lone skeptic, low; "arguably info")
- Novelty: extension of v2-L41 (the un-hoisted twin of the already-fixed
  block-hover path)
- Location: `src/lib/ChatScreens/PartialEditController.svelte:660-727`
  (`isDragActive` `$effect` adds document `selectionchange` /
  capture-phase `scroll` / `mousedown` per instance at `:717-719`, cleanup at
  `:721-726`), `:599-622` (per-message IntersectionObserver, `rootMargin:'300px'`);
  contrast the hoisted block-hover path `:22-192` + `:625-658`
  (`sharedBlockHoverControllers` Set + one shared `mousemove`); mount site
  `Chat.svelte:708-717`.

**What.** `PartialEditController` is mounted once per visible Chat when
`enableBlockPartialEdit` or `enableDragPartialEdit` is set. The block-hover path
was deliberately hoisted in v2-L41 into a module-level shared controller with one
shared document `mousemove`/`scroll` listener. The drag-edit path was NOT
hoisted: each in-viewport instance's `isDragActive` `$effect` independently
registers document `selectionchange`, capture-phase `scroll`, and `mousedown`
listeners. The verifier sharpened three points the finder left soft:

- NOT A LEAK — the `$effect` cleanup (`:721-726`) removes all three listeners and
  clears the debounce timer; when a message scrolls out of the 300px rootMargin,
  `isInViewport` flips false → `isDragActive` false → the effect re-runs and
  cleans up. Listeners attach/detach with viewport membership; they do not
  accumulate.
- Scale is the in-viewport subset (~tens given rootMargin 300px), not the whole
  transcript.
- Per-event cost is light — `handleSelectionChange` only resets a 150 ms debounce
  timer on the event (the getSelection/getBoundingClientRect work runs once per
  timer fire); `handleDragScroll` is a single `display:none` write.

**Impact / trigger.** Only when the opt-in accessibility flag
`enableDragPartialEdit` is on (defaults false). Then ~dozens of live document
listeners exist while editing, each doing redundant light work per
scroll/selectionchange event. Bounded and opt-in.

**Fix.** Hoist the drag-edit listeners to one shared controller with shared
document listeners that fan out to registered instances, mirroring the existing
`registerSharedBlockHoverController`. Keep the cheap per-instance
IntersectionObserver.

## L22 — `BackgroundDom` re-parses the background HTML per guarded projection write

- Severity: low · Category: perf · Area: client
- Finder: `svelte-reactivity-round2` (cid C59), claimed low, confidence medium
- Verification: confirmed (lone skeptic, low)
- Novelty: extension of v3-I19 (a new re-mint consumer surface not in I19's
  enumerated list; never perf-analyzed by v3)
- Location: `src/lib/ChatScreens/BackgroundDom.svelte:13`
  (`currentChar = $derived(DBState.db?.characters?.[selIdState.selId])`,
  object-valued), `:20` (`{#await ParseMarkdown(risuChatParser(...), currentChar,
  'back')}`); re-mint driver `src/ts/server/projectionWriteGuard.svelte.ts:43`/
  `:86-97`/`:116` + per-frame `reloadKeys` bump
  `src/ts/process/postGeneration/streamResponse.ts:93-119`.

**What.** `BackgroundDom` is always mounted in the chat screen but only renders
when `backgroundHTML || $moduleBackgroundEmbedding` is truthy (opt-in). The
`backgroundHTML` derived is string-valued, so equality suppresses no-op
propagation. But `currentChar` is OBJECT-valued, and every guarded write re-mints
the whole `DBState.db` proxy tree to new identities (v3-I19 design), so the
derived returns a fresh proxy reference on every re-mint and always propagates.
The template `{#await}` thunk consumes `currentChar`, so it re-invokes
`risuChatParser` + `ParseMarkdown` over the full background HTML on every
re-mint. The verifier corrected the frequency: not per-token — the H3
`streamCoalescer` caps the guarded write at ~once per animation frame, so the
upper bound is ~60/s for the stream duration, not per streamed token. The
`{#key $ReloadGUIPointer|$VariableReloadGUIPointer}` wrapper gates subtree
teardown on pointer change but does NOT gate the inner `{#await}` thunk's
reactive re-evaluation, which is driven by the `currentChar` proxy-identity churn
(confirmed in the compiled output).

**Impact / trigger.** Only when a custom character/module background HTML is
configured (opt-in, uncommon). When active: ~60 re-parses/sec of one
background-HTML string for the full duration of every streaming reply, on the
main thread. Bounded to a single HTML blob (not per-message), so smaller than
M1; pure waste — the background content does not change during streaming. No
corpus/transcript scaling.

**Verifier notes.** The v3-R3 aside ("BackgroundDom is keyed on
`VariableReloadGUIPointer` and unaffected") was a CORRECTNESS claim (no stale
`{{getvar}}` output), not a perf claim, and does not contradict this finding —
the `{#key}` gates subtree teardown, not the `{#await}` thunk's internal
reactivity.

**Fix.** Stop tracking the whole-character object identity: derive only the
scalar fields the parse needs (e.g. a string char id) and key a `$derived` on
`backgroundHTML` + `$moduleBackgroundEmbedding` + that stable id, so equality
suppresses no-op re-mints. Mirrors the v3-I19 "fix the consumer" guidance and the
v3-L31 disposition.

## L23 — `{{date::fmt}}`/`{{time::fmt}}`/`{{datetimeformat::fmt}}` construct 4 `Intl.DateTimeFormat` per call

- Severity: low · Category: perf · Area: client
- Finder: `sweep:cbs-display-cost` (cid S12), claimed medium, confidence high
- Verification: confirmed 3-0 (all lenses low; calibrated medium → low)
- Novelty: new (no `dateTimeFormat`/`Intl` item in any prior audit; file
  byte-identical since the v3 tree, so a genuine miss not a regression)
- Location: `src/ts/parser/risuChatParserHelpers.ts:55-88` (`dateTimeFormat`,
  the four `Intl.DateTimeFormat('en',{...}).format(date)` replacement arguments
  at `:69`/`:70`/`:79`/`:80`); consumers `cbs.ts:1956` (`date`, alias
  `datetimeformat`) and `:1978` (`time`), wired client-side via
  `parser.svelte.ts:94` and server-side via `prompt/cbsAdapter.ts:121`; display
  path `Chat.svelte:350` (`displaya`, un-memoized `risuChatParser`), `:373-376`
  (`$effect.pre` keyed on `$ReloadGUIPointer`); window `DefaultChatScreen.svelte:107`
  (`loadPages = 30`).

**What.** `dateTimeFormat` builds its result with a chain of `String.replace`
calls where four replacement arguments are
`Intl.DateTimeFormat('en',{...}).format(date)`. JavaScript evaluates a replace()
replacement argument eagerly before testing whether the pattern matches, so ALL
FOUR ICU formatters are constructed on every call even when the format string
contains none of those tokens (verified: `HH:mm:ss` still constructs four). The
no-arg `{{date}}`/`{{time}}` forms build strings manually and are EXEMPT — the
cost hits only the ARG forms `{{date::fmt}}`, `{{time::fmt}}`,
`{{datetimeformat::fmt}}` (verifier correction to the candidate's broader
framing). The candidate's parse-memo worry was a mis-attribution: the display
path is two-stage — `displaya()` runs `risuChatParser` (un-memoized) which
resolves the date/time tags into `msgDisplay`, and only the downstream
`ParseMarkdown` (which by then has no date/time tags) is wrapped by
`memoizedChatBodyParse`. So the cost lives entirely in the un-memoized CBS stage;
there is no clock-driven cache invalidation.

**Impact / trigger.** Content-conditional: only fires when a rendered message,
greeting, persona, lorebook, or preset uses the arg forms (imported third-party
cards are a real vector — timestamp templates are common). On the client,
`displaya()` re-runs via `$effect.pre` on `$ReloadGUIPointer` bumps
(definition/module/regex/chat changes — infrequent config-ish actions, NOT
per-keystroke or per-streaming-frame), re-paying the visible window (default 30,
growable to Infinity). On the server, each occurrence pays once per send on the
event loop. Bounded, episodic, arg-form-gated.

**Verifier notes.** "~225 us/call current vs ~5.6 us cached on Node v24.15.0
(~40×)"; another lens measured "222.52 us/call uncached vs 4.76 us/call cached
(~47×)"; the candidate's absolute ~221 us is accurate, the "~55×" multiplier is
slightly inflated. Worst realistic episodic case ~6.6 ms for 30 occurrences.
Streaming amplification is narrow — per-frame streaming re-pays only the single
streaming message's own change, and live model output rarely contains literal
arg-form date/time CBS tags.

**Fix.** Hoist four module-level `Intl.DateTimeFormat` constants and reference
`.format(date)`, or gate each `.replace` behind a cheap token presence test (`if
(main.includes('MMMM')) …`). Output is byte-identical; reuses the existing
module-singleton pattern (the markdown-it singletons in `parser.svelte.ts`).

---

### Client — translator subsystem (first audit coverage)

## L24 — `translateHTML` has no output memo (full DOMParser + walk per remount)

- Severity: low · Category: perf · Area: client
- Finder: `sweep:translator-render` (cid S2), claimed medium, confidence medium
- Verification: confirmed 3-0 (all lenses low; calibrated medium → low; one lens
  tagged extension-of-v2-M16, two tagged new)
- Novelty: new / adjacent to v2-M16 (the v2 remediation memoized the PARSE half
  of the remount amplifier via v2-L40 but left the TRANSLATE-DOM half
  un-memoized)
- Location: `src/ts/translator/translator.ts:370` (`translateHTML`; non-LLM
  DOM-walk branch `:428-610`, `DOMParser.parseFromString` `:428`, recursive
  `translateNode` `:529`, `XMLSerializer` `:603`, strip regex `:605`, early
  identity return during `doingChat` `:397-401`); `ChatBody.svelte:145`
  (detection-key gate — gates only the `translated` flag) vs `:182`
  (`if (retranslate || translated)` — ungated call), `:394`
  (`markParsingResult = $derived.by(() => markParsing(...))`), `:97`/`:109`
  (`translateHTMLOnce`); parse memo `ChatBodyParseMemo.ts` (`memoizedChatBodyParse`,
  parse only); remount key `Chat.svelte:691`
  (`{#key totalLengthPointer|chatReloadPointer}`).

**What.** `markParsing` is a `$derived.by` that re-runs for every rendered
message; once a message is `translated`, the `if (retranslate || translated)`
branch (`:182`) calls `translateHTMLOnce` → `translateHTML` on EVERY
re-evaluation. The verifier resolved the crux: `lastTranslationDetectionKey`
gates ONLY the detection block (`:145`, which decides whether to set the
`translated` flag), NOT the `:182` translate branch — so when already-translated
and the key is unchanged, control still falls through to call `translateHTML`
with no short-circuit. The parse step (`memoizedChatBodyParse`) is memoized but
`translateHTML` itself has no output memo (grep confirms only
`memoizedChatBodyParse`/`getChatBodyCachedOnlyLlmDecision` are memoized). For the
non-LLM translators (google/deepl/deeplX), each call redoes the full
DOMParser + recursive walk + XMLSerializer + strip; the 256-entry `translateCache`
shields the network fetch but NOT the DOM CPU work.

**Impact / trigger.** Gated behind opt-in `autoTranslate` (default false) plus a
non-LLM translator selected (default `google` is the heavy path). The verifier
corrected the trigger surface: scrolling does NOT re-run `translateHTML` (no
pointer bump, no `$derived` dep change). The real routine triggers are sending a
message (the last ~6 ChatBody instances remount), chat switch (full visible
window remounts via `reloadGuiDisplay` → `ReloadGUIPointer` bump), and
trigger-effect reloads. Window-bounded (default 30), not transcript-length;
redundant CPU only since the network is cached. No crash/hang/data-loss.

**Verifier notes.** Measured per-call DOM cost with happy-dom (the repo's DOM
impl): "~0.189 ms@0.45 KB, ~0.629 ms@3 KB, ~2.738 ms@17 KB, ~10.2 ms@71 KB"
(browser DOMParser/XMLSerializer is typically slower); with ~20-40 visible
translated messages a single guarded write costs tens of ms of synchronous
main-thread work. The LLM branch avoids the walk but still does an async
IndexedDB `getItem` per message per remount — a lower, separate cost. The L59
test mocks `translateHTML` to identity, so this per-render DOM cost is uncovered.

**Fix.** Memoize `translateHTML` output keyed on (`html`, `reverse`,
character/edittrans signature, `getTranslateSettingsSignature()`, the LLM-cache
mutation epoch), reusing `getTranslateSettingsSignature()` already in
`ChatBodyParseMemo.ts`; or, more locally, cache the last (input → translated) per
component run in `markParsing` and skip `translateHTMLOnce` when neither the
post-parse value nor the translate settings changed. (One lens also noted the
`createSimpleCharacter` prop-identity churn as a contributing re-trigger.)

## L25 — `applyEdittransRegex` compiles `new RegExp(script.in)` per render

- Severity: low · Category: perf · Area: client
- Finder: `sweep:translator-render` (cid S3), claimed medium, confidence high
- Verification: confirmed 3-0 (all lenses low; calibrated medium → low)
- Novelty: new (distinct from v1-M2 which fixed `processScriptFull`/triggers via
  `getCompiledRegex`; `applyEdittransRegex` was never swept)
- Location: `src/ts/translator/translator.ts:759` (`applyEdittransRegex`, loop
  `:769-775`, `new RegExp(script.in, script.ableFlag ? script.flag : 'g')` at
  `:771`), called at `:411` (LLM), `:422` (bergamot), `:607` (DOM-walk);
  unused fix-shape pattern `src/ts/process/scripts.ts:126` (`getCompiledRegex`),
  used at `scripts.ts:237` and 9 trigger sites.

**What.** `applyEdittransRegex` runs
`(getModuleRegexScripts() ?? []).concat(alwaysExistChar?.customscript ?? [])` and
for each `edittrans` script compiles `new RegExp(script.in, …)` then
`text.replace(reg, …)`, with no compiled-regex memo. It runs at the tail of ALL
THREE `translateHTML` branches, AFTER the translation result (cached or fresh) is
obtained — crucially it runs even on a pure LLM-cache hit (`translateLLM` returns
the cached value and `:411` still calls it), so the regex recompile is paid on
every re-render regardless of translation caching. Since `translateHTML` is not
memoized (L24), this recompiles every `edittrans` RegExp from source on every
translated-message re-derivation. The existing `getCompiledRegex` LRU pattern
(used by `processScriptFull` and triggers) is simply bypassed here.

**Impact / trigger.** Cost is O(N edittrans scripts) compilations per translated
message per re-derivation, multiplied across visible/remounted translated
messages. Doubly gated: opt-in `autoTranslate` AND the presence of
`edittrans`-type scripts. The verifier corrected the candidate's prevalence
claim — the bundled `data/` corpus has ZERO `edittrans` scripts; a typical card
carries 0, a translation-focused user/module a small single-digit handful (so
with zero scripts the inner `new RegExp` is never reached). The verifier also
corrected the catastrophic-backtracking sub-claim: a compiled-regex memo saves
only the compile step and does NOT change `.replace()` backtracking cost
(backtracking happens at match time regardless), so that sub-claim is incorrect
and does not lift severity.

**Verifier notes.** During active streaming (`doingChat`) `translateHTML` returns
early before reaching `applyEdittransRegex` (except already-LLM-cached content),
so the hot path is settled translated messages re-deriving on `DBState.db`
dependency churn and post-stream renders — not streaming frames.

**Fix.** Memoize compiled `edittrans` regexes via the existing `getCompiledRegex`
helper, or precompute the `edittrans` regex list once per character/module
signature (the same signature already computed in
`ChatBodyParseMemo.scriptSignature`). The one-line shape is replacing the `:771`
`new RegExp(...)` with `getCompiledRegex(script.in, flag)`.

## L26 — LLM translate IndexedDB cache unbounded + quota modal per new segment

- Severity: low · Category: both · Area: client
- Finder: `sweep:translator-render` (cid S4, claimed medium) + `sweep:indexeddb-quota`
  (cid S8, claimed low), confidence high
- Verification: confirmed 3-0 (S4+S8 merged into one finding; all lenses low —
  S8's low calibration confirmed, S4's medium corrected down)
- Novelty: new (nearest prior items — v3-I15 hypaVector cache, v3-L42
  googleCloudTokenizedCache, v3-I17 translator logging — are all different
  stores/mechanisms)
- Location: `src/ts/translator/translator.ts:102`
  (`LLMCacheStorage = localforage.createInstance('LLMTranslateCache')`,
  IndexedDB driver on the live client), `:622` (read), `:701`
  (`await LLMCacheStorage.setItem(text, result)` in `translateLLM`, unguarded),
  `:722` (`setLLMCache`), `:735-746` (`importLLMCacheFromJSON`, per-item
  try/catch), `:754` (`clearLLMCache`); only manual clear callers
  `PlaygroundTranslation.svelte:154` and `languageSettingsData.svelte.ts:370`;
  in-memory cap contrast `translator.ts:76-82`
  (`writeTranslateCache`, 256-entry LRU); quota surfacing chain
  `ChatBody.svelte:111-113` → `:70` (`reportParsingError`) → `alert.ts:50`
  (`alertError`).

**What.** `translateLLM` caches every LLM translation with
`LLMCacheStorage.setItem(text, result)` keyed by full source text, with no
LRU/TTL/size/count cap (the in-memory `translateCache` IS capped at 256; the
persistent store is not). The only reclamation is the manual `clearLLMCache()`
button; deleting messages never GCs it. The `:701` `setItem` is NOT wrapped in
try/catch (the import path at `:741` IS — verifier correction folding both
candidates). On quota exhaustion the `QuotaExceededError` rejects out of
`translateLLM` → `translateHTML` → `translateHTMLOnce`'s catch → `reportParsingError`
→ `alertError` (a real visible modal, not silently swallowed and not a floating
rejection). The verifier corrected one over-broad claim: the cache READ at `:622`
precedes the WRITE at `:701`, so once quota is full the modal fires only on
NEW/uncached segments — already-cached segments still read and render fine.
Beyond both candidates: once full, each subsequent cache-missing render re-fires
both the error modal AND the paid LLM `requestChatData('translate')` call — a
recurring API-cost amplification.

**Impact / trigger.** Doubly opt-in: `autoTranslate` (default false) AND
`translatorType === 'llm'` (default `google`). `autoTranslateCachedOnly`, when
on, reads only and never triggers the quota write. Each entry stores key (full
source) + value (full translation), ~1.8-5 KiB; realistic growth ~1.5-28 MiB/mo
(~0.08-0.33 GiB/yr), so reaching an actual quota on a modern multi-GB origin
takes years of heavy use (faster if co-resident with the hypaVector embedding
cache and other stores sharing the quota group). Slow latent disk growth +
bounded quota-modal annoyance on uncached segments; fully recoverable via the
manual-clear button.

**Verifier notes.** S8's location note suggested scoping/pruning by chat like the
in-memory cache — this does NOT transfer, because the persistent store has no
scope key (entries keyed by raw text only), so an LRU-by-count/byte index is the
only viable in-place fix.

**Fix.** Add a count/byte-cap LRU eviction to the persistent store (mirror the
in-memory `TRANSLATE_CACHE_MAX_ENTRIES` concept, evicting via
`iterate`/`removeItem`), and wrap the `:701` `setItem` in try/catch so a quota
failure degrades to an uncached-but-successful translation (keep the freshly
computed translation in the in-memory cache) instead of an error modal.

## L27 — deeplX chunk-mismatch N+1 sequential fallback through the shared rate gate

- Severity: low · Category: perf · Area: client
- Finder: `sweep:translator-render` (cid S5), claimed low, confidence medium
- Verification: confirmed (lone skeptic, low; "borderline info")
- Novelty: new (no prior item covers the deeplX super-chunk mismatch fallback or
  the `waitTrans` gate amplification)
- Location: `src/ts/translator/translator.ts:441` (`translateTranslationChunks`,
  join `\n■\n` at `:447`, split on bare `■` at `:464`, mismatch fallback
  sequential loop `:466-471`), `:247-254` (deeplX `waitTrans` gate in
  `translateMain`), `:613-615` (`needSuperChunkedTranslate`, true only for
  `deeplX`).

**What.** For `deeplX`, `translateHTML` batches text nodes into ~5000-char chunks
joined by `\n■\n` and translates them as one `translate()` call, then splits on
`■`. If the translator alters/drops the delimiter so
`split.length !== chunks.length`, the code falls back to translating each chunk
individually in a sequential `await` loop — N additional real network calls (no
cache hit: individual chunk keys differ from the combined-text key) on top of the
1 combined call. The verifier corrected the gate semantics: `waitTrans` is NOT a
fixed per-call 3s tax — it only sleeps when `waitTrans - Date.now() > 0`, and the
`waitTrans = Date.now() + 3000` assignment lives INSIDE the `if`, so an
isolated/cold first call neither sleeps nor primes the gate. The gate engages
only once primed by an OVERLAPPING concurrent deeplX `translate()` call; once
primed it is self-perpetuating (each sleeping call re-arms it ~3s into the
future). Priming is routine in normal use (opening a chat renders multiple
ChatBody components concurrently against the shared module-level `waitTrans`), so
the N-fold amplification is real, but the per-call-3s framing is loose.

**Impact / trigger.** Triple-gated opt-in: `autoTranslate` on + `translatorType
=== 'deeplX'` + a configured DeepLX endpoint (`noWaitForTranslate` defaults
falsy, so the gate is active by default for deeplX users). The split-mismatch is
an error-recovery path, fired only when the `■` (U+25A0) count differs — requires
either source text containing a literal `■` (rare; a real but uncommon vector via
imported third-party cards/lorebooks) or the backend dropping/duplicating it. Not
routine. Worst case: one mismatched long message's translated overlay is delayed
by ~3N seconds when the gate is primed; the underlying message still renders. No
crash/hang/loss/growth.

**Verifier notes.** Adjacent latent issue flagged but NOT folded in (same
opt-in subsystem, different mechanism): `translateTranslationChunks` is invoked
fire-and-forget inside a Promise executor (`:482`); if the inner `translate()`
truly THROWS (vs returning an `ERR::` string), the resolvers are never called and
`await prm` (`:487`) hangs that message's translation permanently — a real
per-message hang risk on the throw path, orthogonal to the chunk-mismatch claim.

**Fix.** Use a per-chunk sentinel that survives translation (a unique unlikely
token per index) and/or detect mismatch before consuming the rate budget; scope
the rate gate so the one-by-one fallback does not multiply waits; pick a
delimiter unlikely to appear in source text.

## L28 — No `QuotaExceededError` handling across localforage `setItem` sites

- Severity: low · Category: both · Area: client
- Finder: `sweep:indexeddb-quota` (cid S9), claimed low, confidence medium
- Verification: confirmed (lone skeptic, low)
- Novelty: new (no prior item covers `QuotaExceededError` handling or the
  translation re-pay-on-write-failure loop; v3-I15 is the growth source, not this
  missing handler)
- Location: `src/ts/translator/translator.ts:701` (`LLMCacheStorage.setItem`,
  render-path); other unguarded `setItem` sites — `:723`/`:742` (translator),
  `inlays.ts:95` (`inlayStorage`), `mcp.ts:438` (`mcp-tool-calls`),
  `v3.svelte.ts:658/660` (`permissionForage`), `pluginSafeClass.ts:77`
  (`pluginStorage`), `risuSave.ts:388`, `IrisModal.svelte:178`, plus
  `hypamemory*.ts`/`hypav3.ts`; render-path catch
  `ChatBody.svelte:97-117` (`translateHTMLOnce` → `reportParsingError`);
  floating-write path `Chat.svelte:344-348` (`saveTranslationEdit`,
  `await setLLMCache` with no try/catch, invoked fire-and-forget from `:617`/`:637`)
  → global handler `bootstrap.ts:454-459` (`unhandledrejection` → `alertError`).

**What.** A repo-wide search finds ZERO `QuotaExceededError`-specific handling at
any localforage `setItem` boundary. Behavior on quota differs by path: (a)
render-path LLM translation throws AFTER the paid API call succeeded;
`translateHTMLOnce` catches it, calls `reportParsingError`, returns the
untranslated fallback, and DISCARDS the result — so every subsequent re-render
re-issues the paid translate and fails to cache again (a repeating paid-work +
silent-loss loop, surfaced as a generic parsing-error modal); (b) awaited writes
with no local catch propagate and abort the operation; (c) genuinely floating
writes (e.g. `saveTranslationEdit`) reach the global `unhandledrejection` handler
→ `alertError` modal with a raw `DOMException`. The verifier corrected two
sub-claims: `importLLMCacheFromJSON` is HANDLED (per-item try/catch at `:741-746`,
surfaced with counts) — it is NOT a floating rejection, so drop it from that
bucket; and the `encodeToolCall` tool-loop example (`mcp.ts:438`) is
unverified-liveness (its client provider callers are likely not on the live
default server-assembly send path). The CORE claim is fully verified.

**Impact / trigger.** Manifests only once a store has already grown to fill the
origin quota (a latent precondition; IDB quota is large on single-user
self-host). The render-path re-pay loop is gated on opt-in `autoTranslate` +
`translatorType === 'llm'`. Real, actionable, bounded, latent.

**Verifier notes.** `translateLLM`'s only cache check is the persistent
`getItem`; there is NO in-memory LLM fallback (the in-memory `translateCache` Map
is used only by the google/deepl path, never by `translateLLM`), so a failed
persistent write means the next re-render re-pays the paid translate.

**Fix.** Catch `QuotaExceededError` at each `setItem` boundary and surface one
actionable message ("local cache full — clear translation/tool cache"); for the
translator, keep the freshly computed translation in the in-memory cache even
when the persistent write fails so re-renders do not re-pay.

## L29 — `combineTranslation` fragments a multi-line paragraph per `<br>` line

- Severity: low · Category: perf · Area: client
- Finder: `sweep:flag-multiplier-matrix` (cid S15), claimed medium, confidence
  high
- Verification: confirmed 3-0 (all lenses low; calibrated medium → low)
- Novelty: new (no `combineTranslation` entry in any prior audit; file unchanged
  since the v3 tree)
- Location: `src/ts/translator/translator.ts:549-581` (`translateNode`
  combine branch) → `:478-525` (`translateNodeText`, `reprocessDisplayScript=true`
  runs `processScriptFull('editdisplay')` per call), super-chunk early-return
  `:480-489`, non-combine split `/\n\n+/g` `:491`; `util.ts:670`
  (`getNodetextToSentence`, `<br>` → `\n`); `scripts.ts:145-188`
  (`processScriptFull`: `runLuaEditTrigger` `:154`, `runTrigger('display')`
  `:156-170`, all BEFORE the script-cache check `:184-188`);
  `triggers.ts:1276` (`displayMode` skips the transcript clone); reached from
  `ChatBody.svelte:221-294` (`markParsing` → `translateHTMLOnce` → `translateHTML`);
  default `database.svelte.ts:614` (`combineTranslation ??= false`); help text
  `en.ts:183-184`.

**What.** When `db.combineTranslation` is true and a rendered `<p>` contains
multiple `<br>`-separated lines, `translateNode` rebuilds the paragraph and loops
PER line, calling `translateNodeText(newNode, true)` with
`reprocessDisplayScript=true`. The candidate claimed this multiplies BOTH network
translate calls and editdisplay passes per line. The verifiers corrected the
network-call half on two counts:

- The network-call multiplier is wrong. In the non-combine path, a `<p>` like
  `text1<br>text2<br>text3` parses to SEPARATE DOM text nodes, and EACH text node
  already hits its own `translateNodeText(node)` → its own `translate()` call (the
  `/\n\n+/g` split only splits within a single text node on DOUBLE newlines,
  which the `<br>` case never produces). So the non-combine path already makes
  ~N calls; combine does NOT multiply network calls (it can even reduce them by
  folding inline `<em>`/`<strong>` into one sentence string).
- The deeplX 3s-stall claim is refuted. deeplX takes the super-chunk early-return
  (`:480-489`) before reaching either the per-chunk `translate()` calls or the
  editdisplay code — it batches into `■`-joined super-chunks. So deeplX gets
  neither per-line network calls nor per-line editdisplay (a side effect: combine
  is silently a no-op for deeplX — a correctness gap, not this perf finding).

The GENUINELY new cost is the per-line `processScriptFull('editdisplay')` pass:
the non-combine path calls `translateNodeText(node)` with
`reprocessDisplayScript=false` and runs ZERO editdisplay during HTML translation,
so combine ADDS N editdisplay passes (one per `<br>` line) rather than
multiplying an existing one. The candidate's "inverts advertised combine
behavior" framing is correct — the help text says combine then reapply ONCE; the
code splits and reapplies PER fragment. Each editdisplay pass runs
`runLuaEditTrigger` + the `display` `runTrigger` + `risuChatParser` BEFORE the
script-cache check, so those portions are NOT memoized and re-run per line even
for identical content. `runTrigger` in displayMode does NOT clone the transcript
(`triggers.ts:1276`), so the per-line cost is bounded display-trigger + CBS work.

**Impact / trigger.** Doubly opt-in: `autoTranslate` (default false) AND
`combineTranslation` (default false), and only fires for the google (default
heavy path) and deepl translators (LLM/bergamot return early; deeplX skips
editdisplay). A typical RP reply (5-15 `<br>` lines) becomes 5-15 editdisplay
passes per render instead of 1. Worst realistic case (a character with Lua
display triggers + many lines) is a multi-second client stall per message — a
narrow conjunction. No crash, no event-loop block (client-side, awaited, yields
between lines), no data loss, no growth.

**Fix.** Translate the reconstructed paragraph as a single unit (join split
sentences with a sentinel, one `translate()` call, split the result back — reuse
the `■` join+split pattern from `translateTranslationChunks`) and run
`processScriptFull('editdisplay')` once over the combined paragraph; or gate the
per-sentence loop behind a length threshold.

## L30 — `getCurrentTranslatorPreset` writes the read-only projection → THROWS on every LLM-translate call

- Severity: low · Category: perf · Area: client
- Finder: `sweep:translator-render` (cid S6), claimed info, confidence high
- Verification: confirmed (lone skeptic), upgraded info → low
- Novelty: extension of v3-L34 (same read-only-projection-write class, at an
  un-enumerated site)
- Location: `src/ts/translator/presets.ts:172-182`
  (`getCurrentTranslatorPresetFromState` writes `state.translatorPrompt` /
  `state.translatorMaxResponse` in both the preset and the normalize/`syncCurrentTranslatorPresetToLegacyFields`
  branches); `translator.ts:119`
  (`getCurrentTranslatorPreset()` passes `getDatabase()` with no snapshot →
  `DBState.db`), `:649` (call site in `translateLLM`, before the network request
  and cache write); `database.svelte.ts:962-966` (`getDatabase` returns the
  projection); guard `projectionWriteGuard.svelte.ts:126-128` (set trap throws
  unconditionally); `bootstrap.ts:164` (guard enabled unconditionally);
  catch `ChatBody.svelte:97-117` → `:70` (`reportParsingError`).

**What.** `getCurrentTranslatorPreset()` passes the live `getDatabase()` (the
read-only SERVER PROJECTION proxy) into `getCurrentTranslatorPresetFromState`,
whose success path executes `state.translatorPrompt = preset.prompt;
state.translatorMaxResponse = preset.maxResponse` (and the normalize branch also
writes). The candidate filed this as `info`, reasoning the write is "inert due to
Svelte 5's value-equality short-circuit." The skeptic refuted that disposition
and UPGRADED to low: the projection is NOT a Svelte `$state` proxy — it is a
custom `Proxy` whose `set` trap throws `TypeError('Cannot mutate read-only server
projection')` UNCONDITIONALLY, with no value-equality check. So the write THROWS
on every execution. In `translateLLM`, on a cache miss (always a miss when
`arg.regenerate`), execution reaches `getCurrentTranslatorPreset()` at `:649`
BEFORE the network request, so it throws before any translation — and throws
again on every re-render since the line is never translated or cached.

**Impact / trigger.** Opt-in: `translatorType === 'llm'` (default `google`) +
auto-translating messages. The throw is caught by `translateHTMLOnce` →
`reportParsingError` → `alertError`, so every cache-missed LLM translation pops an
error modal ("…Cannot mutate read-only server projection…") and shows untranslated
text. The LLM translator mode is effectively non-functional for any new line. Not
a crash/hang/data-loss; confined to an opt-in non-default subsystem; caught and
surfaced as a modal.

**Verifier notes.** This is the SAME class as v3-L34/L35/L36 (read-only-projection
write → TypeError) but a DIFFERENT, un-enumerated location — it should fold into
the v3 Phase-5 projection-guard repair batch, and that slice should become a
tree-wide `getDatabase()`-write-back sweep rather than an enumerated-site fix.

**Fix.** Have `getCurrentTranslatorPreset` pass a snapshot
(`getDatabase({ snapshot: true })`), or refactor
`getCurrentTranslatorPresetFromState` to not write the legacy fields on the read
path (confine the legacy-field sync to normalize/settings-save paths).

---

### Client — stage-4 post-generation / MCP / media

## L31 — Imggen post-gen ignores the abort signal (post-completion case)

- Severity: low · Category: both · Area: client
- Finder: `sweep:stage4-postgen` (cid S0), claimed low, confidence high
- Verification: confirmed (lone skeptic, low)
- Novelty: new (v3-L50 covers only logging in the comfy poll; v3-K4 covers NAI
  reference-image load; neither addresses imggen abort-gating or poll
  cancellation)
- Location: `src/ts/process/postGeneration/runStage4.ts:112-114` (imggen branch,
  no `abortSignal` gate, no signal passed) vs `:89` (emotion branch gate
  `abortSignal.aborted === false`); `imggenStableDiff.ts:11-24`
  (`runImggenStableDiff`, no signal threaded); `stableDiff.ts:33`
  (`requestChatData(..., 'submodel')`, abortSignal arg omitted → defaults null),
  `:563-579` (comfy `while(!(item=...))` poll every 1s up to
  `db.comfyConfig.timeout`), `:883-920` (wavespeed `while(true)` poll every 3s up
  to `MAX_WAIT_TIME = 10 min`); `runStage4` call site `index.svelte.ts:434`;
  abort short-circuit `orchestrateResponse.ts:115`, `index.svelte.ts:398`;
  `doingChat` released in `finally` at `index.svelte.ts:466`.

**What.** `runStage4` reaches the imggen branch whenever
`currentChar.viewScreen === 'imggen'` and runs unconditionally after
`orchestrateResponse` — it is NOT gated by `serverOwnsPostGeneration`. Unlike the
sibling emotion branch (`:89`, `abortSignal.aborted === false` gate), the imggen
branch has no abort gate, and `runImggenStableDiff`/`stableDiff` thread no
`AbortSignal`: `stableDiff` calls `requestChatData(arg, 'submodel')` with the
third (abortSignal) arg omitted, so the caption request's own abort checks
(`request.ts:261/305`) can never fire; then `generateAIImage` runs comfy/wavespeed
poll loops with no abort listener. The verifier corrected the trigger framing:
mid-stream aborts never reach stage 4 — `orchestrateResponse` returns `aborted`
and `index.svelte.ts:398` returns false BEFORE `runStage4`. The gap is the
post-completion case: when the stream completed naturally (`done`) but abort
fires during stage 4 or the `await serverTerminal`, the emotion branch's gate
covers that window and the imggen branch does not.

**Impact / trigger.** Per send to an imggen-mode character (opt-in per-character
`viewScreen`, default `none`). The verifier sharpened the stronger,
non-abort-specific defect: `doingChat` is released only in the `finally`
(`:466`), AFTER `runStage4`/`stableDiff` fully return, so EVERY imggen send holds
the `doingChat` lease (blocking new sends, UI shows "generating") for the full
caption-call + image-poll duration — up to `db.comfyConfig.timeout` (comfy) or 10
min (wavespeed) — and the Stop button cannot cancel it. Bounded to one in-flight
op (no growth, no event-loop block since these are async awaits); the comfy/
wavespeed loops are effectively unkillable until their own timeout.

**Fix.** Mirror the emotion branch: gate the imggen branch on
`abortSignal.aborted === false`; thread `abortSignal` through
`runImggenStableDiff` → `stableDiff` → `requestChatData(..., 'submodel',
abortSignal)`; and add abort checks/listeners inside the comfy and wavespeed poll
loops alongside their existing timeout checks.

## L32 — Every internal `requestChatData` fires the client `request` trigger pass

- Severity: low · Category: perf · Area: client
- Finder: `sweep:stage4-postgen` (cid S1, claimed low) + `sweep:flag-multiplier-matrix`
  (cid S16, claimed low), confidence high/medium
- Verification: confirmed (lone skeptic, low; S1+S16 merged, S16's
  full-transcript-clone headline REFUTED)
- Novelty: extension of v3-L8 (refines L8's scope — the displayMode client pass
  is distinct from L8's non-display server-side clone)
- Location: `src/ts/process/request/request.ts:274-293`
  (`runTrigger(currentChar, 'request', {displayMode:true, displayData:
  JSON.stringify(arg.formated)})` at the top of the retry loop, then JSON.parse
  back; `console.log('Trigger time')` `:289`, `console.log(set)` `:324`);
  `triggers.ts:1251` (zero-trigger early-out), `:1265` (charMaterialized pre-set
  true), `:1276` (`displayMode ? arg.chat : safeStructuredClone(...)`); main-send
  bypass `index.svelte.ts:331-343` (server-dispatch branch never calls
  `dispatchRequest`/`requestChatData`); internal callers `translator.ts:677`,
  `emotionFallbackLlm.ts:81`, `igp.ts:17`, `hypav3.ts:1590`, `aiaccess.ts:67`,
  `stableDiff.ts:33`, `scriptings.ts:565/615/940`, `triggers.ts:1684/2169`.

**What.** `requestChatData` runs the character's `request`-mode trigger at the top
of its retry loop for EVERY mode, JSON.stringifying `arg.formated` into
`displayData`, running the trigger interpreter, and JSON.parsing the result back.
The verifier REFUTED S16's headline "full-transcript clone": `runTrigger` is
called with `displayMode:true`, which skips BOTH heavy clones — `chat` stays the
passed reference (`triggers.ts:1276`) and `charMaterialized` is pre-set true
(`:1265`), so the per-call cost is trigger-script iteration + a stringify
proportional to prompt size, NOT a transcript clone. `runTrigger` early-outs when
the character has no triggers (`:1251`), so the cost is gated to trigger-bearing
characters. S1's central asymmetry claim is correct and verified: on a normal
server-assembled main `model` send (`useServerPromptAssembly` default true), the
client does NOT run `runTrigger('request')` (the server-dispatch branch never
calls `requestChatData`; triggers run server-side); only the secondary/internal
`requestChatData` callers pay the extra client pass.

**Impact / trigger.** Per auxiliary call to a trigger-bearing character: LLM
auto-translate (per visible translated message, `translatorType === 'llm'` +
`autoTranslate`), emotion fallback, submodel caption, memory summarize, MCP
runLLM, Lua `LLM()`/`request` (lowLevelAccess-gated, re-entrant). The retry loop
re-runs the pass up to `requestRetrys + 1` times per call. Doubly gated (a
trigger-bearing character AND a secondary-LLM-spawning feature/flag), bounded by
trigger-script count and visible-message count. Abort is threaded
(`request.ts:261-266`). No crash/hang/growth.

**Verifier notes.** The two `console.log` lines (`'Trigger time'`, `set`) are
already noted in the v3 registry for fold-if-touched.

**Fix.** Run the `request` trigger only on the primary user-facing send modes (or
pass an opt-out arg so translate/emotion/memory/mcp/scripting callers skip it);
remove the unconditional logs from the hot retry loop.

## L33 — Internal MCP `checkHandshake` throws unguarded in `initializeMCPs`

- Severity: low · Category: stab · Area: client
- Finder: `sweep:mcp-internal-clients` (cid S18), claimed low, confidence high
- Verification: confirmed (lone skeptic, low — "bordering info")
- Novelty: extension of v3-L46 (same `mcp.ts:82-172` construction block; the
  unguarded-throw is a distinct failure mode from L46's check-then-await race)
- Location: `src/ts/process/mcp/mcp.ts:85-124` (the `internal:` branch, unguarded
  `await MCPs[mcp].checkHandshake()` at `:122`; client cached at `:104` BEFORE
  handshake; cleanup-loop reconstruction `:176-182`; `if (!MCPs[mcp])` guard
  `:82`; in-app import blocked in server mode `:391-394`) vs the remote-URL branch
  `:159-172` (try/catch-wrapped); `googlesearchclient.ts:154-158`
  (`initializeCredentials` throws unconditionally), `:146-152` (`checkHandshake`);
  `filesystemclient.ts:289-322` (`checkHandshake` → `showDirectoryPicker`);
  propagation `getMCPTools` → `getTools` → `request.ts:238`
  (`arg.tools ?? (await getTools())`, no try/catch).

**What.** In `initializeMCPs`, the `internal:` construction branch calls `await
MCPs[mcp].checkHandshake()` with NO try/catch (unlike the remote-URL branch,
which wraps construction+handshake). `GoogleSearchClient.checkHandshake()` →
`initializeCredentials()` throws unconditionally ("…not supported in server-backed
web mode"); `FileSystemClient.checkHandshake()` → `showDirectoryPicker()` rejects
when there is no user gesture (a background suggestion/translator call is not
one). The throw escapes `initializeMCPs` (the try/finally only decrements depth) →
`getMCPTools` → `getTools` → rejects `requestChatData` at `request.ts:238`. Because
`MCPs[mcp]` is assigned BEFORE handshake, the client is cached, so the next
`initializeMCPs` skips re-handshake (the `:82` guard) — the throw is one-shot per
client construction, recurring on page load and whenever the cleanup loop
reconstructs internal clients on a module-set change. The verifier pruned the
candidate's caller list: "suggestion feature" and "IrisModal" as live
getTools()-consumers are UNVERIFIED. The positively-verified live callers that hit
`arg.tools ?? (await getTools())` are the LLM translator `translateLLM`
(`translator.ts:677`), the client Lua `request`/`simpleLLM` host functions
(`scriptings.ts:565/615`), and aiaccess (`aiaccess.ts:67`).

**Impact / trigger.** If a module carrying `mcp.url === 'internal:googlesearch'`
(or `internal:fs`) is enabled, the FIRST such requestChatData after page load /
module-set change rejects outright rather than degrading to "no tools." Live chat
send is unaffected (server owns tool gathering on the default server-assembly
path; the client `getTools()` path is reached only on the `local` assembly
fallback, which the Fastify runtime hard-fails). Opt-in modules (these enter
`db.modules` only via imported third-party content since the in-app import UI is
blocked in server mode), opt-in features, self-recovering after one failure. Low,
bordering info.

**Fix.** Wrap the `internal:` branch's construction + `await checkHandshake()` in
the same try/catch the remote branch uses (`console.error`, leave the client
uninitialized/removed, continue so `getTools()` still returns the other clients'
tools); alternatively make `GoogleSearchClient.checkHandshake()` resolve and
surface the unsupported message only from `callTool`.

## L34 — GraphMem `readMemory` re-embeds every node per call (embed entirely wasted)

- Severity: low · Category: perf · Area: client
- Finder: `sweep:mcp-internal-clients` (cid S19), claimed info, confidence high
- Verification: confirmed (lone skeptic), upgraded info → low (latent correctness
  defect found)
- Novelty: new (no prior item covers graphmem; v3-L45/L46/L47/L48 are unrelated
  MCP concerns)
- Location: `src/ts/process/mcp/graphmem.ts:115-167` (`handleReadMemory`,
  `await processer.embedDocuments(graph.map(g => g.name))` at `:139-140`,
  `processer.similaritySearch(searchTerm)` at `:152`), `:92-113`
  (`handleWriteMemory` appends uncapped to the `graphmem_graph` chat var);
  `hypamemory.ts:69-83` (`embedDocuments` returns vectors WITHOUT populating
  `this.vectors`), `:59` (constructor `this.vectors = []`), `:218`
  (`addText` — the only method that fills `this.vectors`), `:230-246`
  (`similaritySearchVectorWithScore` iterates `this.vectors`); dispatch
  `mcp.ts:328-349` (`callTool`), provider call sites e.g. `google.ts:903/1225`.

**What.** `handleReadMemory` parses the full `graphmem_graph` chat var, constructs
a fresh `HypaProcesser`, and calls `embedDocuments(graph.map(g => g.name))` over
ALL nodes on every readMemory tool call (no cache, no incremental embed);
`handleWriteMemory` monotonically pushes nodes with no cap. So read cost scales
linearly with the number of nodes ever written, redone from scratch each read. The
skeptic UPGRADED the candidate's `info` to `low` and found the embed is ENTIRELY
WASTED: `embedDocuments` returns vectors WITHOUT populating `this.vectors`
(unlike `addText`), so the subsequent `similaritySearch` iterates the still-empty
default `this.vectors = []` and always returns an empty array — the graph
traversal finds nothing and `readMemory` always returns empty `entries` for every
query. The whole-graph embed produces zero usable output: a latent correctness
defect on top of the wasted cost.

**Impact / trigger.** Opt-in (a module whose `mcp.url === 'internal:graphmem'`)
and per-tool-call (not per send) — reached when the model emits a `readMemory`
tool call during a client-side chat send. Per-read embed fan-out grows with
session graph size; bounded by being opt-in and tool-call-gated. The correctness
bug (always-empty result) is what lifts it above info.

**Fix.** Use `addText(...)` instead of `embedDocuments(...)` — `addText` both
populates `this.vectors` AND uses the forage cache, simultaneously fixing the
wasted re-embed (forage cache hit on unchanged node names) and the always-empty
result; embed incrementally on `writeMemory` and persist the vectors; consider a
node-count cap.

## L35 — FileSystem MCP base64 read `String.fromCharCode(...uint8Array)` (RangeError ~122.5 KB)

- Severity: low · Category: stab · Area: client
- Finder: `sweep:mcp-internal-clients` (cid S20), claimed info, confidence medium
- Verification: confirmed (lone skeptic), upgraded info → low (empirical threshold
  far below the cap)
- Novelty: new (v3-L48 covers only the PDF full-res render path; no item mentions
  the base64 spread RangeError or the fs read/scan bounds)
- Location: `src/ts/process/mcp/filesystemclient.ts:509-554`
  (`readFileAsBase64`, `btoa(String.fromCharCode(...uint8Array))` at `:528`,
  `maxImageLimit = 5MB` at `:400`, inner catch `:415-422`), `:679-774`
  (`searchFiles`/`searchInDirectory` content search `await file.text()` per file,
  no per-file size cap), `:904-982` (`findDuplicates` byContent reads full
  arrayBuffer per file); outer catch `mcp.ts:328-373` (`callTool`).

**What.** `readFileAsBase64` builds base64 via `String.fromCharCode(...uint8Array)`
— spreading an up-to-5MB byte array as function arguments. The candidate filed
this as `info` ("only near 5MB"); the skeptic empirically confirmed on Node
v24.15.0 that the spread throws `RangeError: Maximum call stack size exceeded` at
~122.5 KB (binary-searched first-failing size 125429 bytes; 126976 with
`--stack-size=2000`) — ~42× BELOW the 5MB cap. So `fs_read_file` reliably fails
for ANY image larger than ~125 KB (the common case for real photos/PNGs), always
returning an error string. The RangeError is double-caught (readFile's inner
try/catch + `callTool`'s outer catch), so there is NO tab/server crash — a caught,
degraded-feature error. Separately, content search does `await file.text()` per
file with no size cap and `findDuplicates(byContent)` reads each full buffer.

**Impact / trigger.** Opt-in `internal:fs` module + File System Access API
(browser/gesture-gated), reached only via a model-issued `fs_read_file` tool call.
Self-inflicted, contained (no crash), confined to an opt-in subsystem — low.

**Verifier notes.** The candidate's "the codebase already has chunked base64
helpers" is inaccurate — the only sibling encoder (`util.ts:1269` `base64url`)
uses the SAME broken spread, and globalApi's `chunk*` helpers are for asset-upload
batching, not base64.

**Fix.** Add a real chunked encoder (reduce over ~8 KB slices) or use
`FileReader.readAsDataURL`; cap per-file bytes in the content search and
`findDuplicates` the same way `readFile` caps text at 100 KB.

## L36 — `writeInlayImage` full-res main-thread decode of model-supplied images

- Severity: low · Category: both · Area: client
- Finder: `sweep:image-ingest-path` (cid S22), claimed low, confidence medium
- Verification: confirmed (lone skeptic, low)
- Novelty: new (v2-L49 added only onload-hang/onerror + the OUTPUT cap, no source
  guard; v3-L51 is object-URL revoke and uses a different `data:`-URL path here)
- Location: `src/ts/process/files/inlays.ts:206` (`writeInlayImage`), `:214`/`:123`
  (`waitForInlayImageLoad` → `imgObj.decode()`), `:217-225` (`maxPixels =
  1024*1024`, bounds only the destination), `:229` (`ctx.drawImage` at source
  dims); reached from `src/ts/process/request/google.ts:794-802`
  (`inlineData` image → `imgObj.src = data:...` from the parsed model/proxy
  response), gate `google.ts:440`
  (`arg.imageResponse || modelInfo.flags.includes(LLMFlags.hasImageOutput)`),
  `imageResponse` wired from `DBState.db.outputImageModal` at
  `dispatchRequest.ts:110` (default false).

**What.** `writeInlayImage` caps the OUTPUT canvas at `maxPixels = 1024*1024` but
first fully decodes the SOURCE image: `waitForInlayImageLoad` awaits
`imgObj.decode()` and then `ctx.drawImage(imgObj, 0, 0, drawWidth, drawHeight)`.
The browser must materialize the full source bitmap (width×height×4 bytes RGBA)
before the downscale draw; the cap only bounds the destination, and source
dimensions are never validated. In `google.ts:794-802` the Image src is
`data:${mimeType};base64,${data}` taken verbatim from the model/proxy response —
proxied model output, a scope-sanctioned hostile vector. A tiny highly-compressed
PNG/WEBP declaring e.g. 30000×30000 decodes to ~3.6 GB RGBA. The verifier named
the precise gate: the decode only fires when `imageResponse` (=
`DBState.db.outputImageModal`, an opt-in Prompt Setting defaulting false) is on OR
the selected model carries the `hasImageOutput` flag (specific Gemini
image-output models) — it is NOT on the default text-send path.

**Impact / trigger.** Receiving a Gemini-format response whose `inlineData` is an
image, when the model/proxy is malicious or the chosen proxy is compromised.
Consequence: the main-thread decode + drawImage of a bomb image stalls or OOMs the
renderer. Per returned image, scaling by declared source dimensions (independent
of transfer size). Confined to the opt-in image-output subsystem; the realistic
worst case is a UI stall rather than a deterministic crash, because browser image
decoders apply their own dimension limits (~32k) and often error rather than OOM —
which is why this is low rather than high. The self-paste path
(`DefaultChatScreen.svelte:692`) hits the same decode but is self-inflicted and
out of scope.

**Fix.** After decode, gate on declared dimensions
(`imgObj.naturalWidth * naturalHeight` against a hard bound, e.g. 8192×8192) and
reject before `drawImage`; optionally pre-parse a dimension cap from the header
bytes for the untrusted `google.ts` path specifically. No existing helper covers
source dimensions — add the SOURCE guard at the existing `maxPixels` location.

---

### Client — plugins / auth

## L37 — V3 plugin guest document listeners + `SafeMutationObserver` never removed on unload

- Severity: low · Category: stab · Area: client
- Finder: `client-listener-leaks` (cid C23), claimed medium, confidence high
- Verification: confirmed 3-0 (liveness held medium, mechanism + severity
  corrected to low → calibrated low)
- Novelty: extension of v3-M7 (same lifecycle family, but a separate cleanup
  surface — M7's fix touches only `factory.ts`'s RPC `message` listener and does
  nothing for these `v3.svelte.ts` guest registrations)
- Location: `src/ts/plugins/apiV3/v3.svelte.ts:305-394`
  (`SafeElement.addEventListener` → real `document.addEventListener` at `:376`/
  `:389`, tracked only in a per-instance `#eventIdMap` at `:303`; `removeEventListener`
  exists at `:396` but no host sweep), `:494-535` (`SafeMutationObserver`, real
  `MutationObserver` at `:498`, `observe` at `:531`, NO `disconnect` method),
  `:1071-1076` (`getRootDocument`, mainDom-permission gated), `:1228-1230`
  (`createMutationObserver`, NO permission gate), `:555-584` (`unloadV3Plugin` →
  `host.terminate()`), reload `:1449-1457` (`loadV3Plugins`); teardown
  `factory.ts:627-635` (`terminate` only removes the iframe + clears RPC maps);
  RPC growth `factory.ts:410/413/457`; reload triggers `PluginSettings.svelte:179`
  (toggle) / `:210` (delete), `plugins.svelte.ts:494` (import).

**What.** A V3 plugin can call `getRootDocument()` (mainDom-permission gated) to
obtain a `SafeDocument` and then `SafeElement.addEventListener`, which registers a
real `document.addEventListener` whose handler RPCs into the guest iframe; it can
also call `createMutationObserver()` (ungated for ANY enabled V3 plugin) to build
a real `MutationObserver` observing the host DOM. Neither is tracked by the
`SandboxHost`: `#eventIdMap` is per-SafeElement-instance, and `SafeMutationObserver`
exposes NO `disconnect` method at all. On plugin disable/reload, `unloadV3Plugin`
drains the `onUnload` callbacks then calls `host.terminate()`, which only removes
the iframe and clears the RPC maps — the document listeners stay registered and
the observer stays connected, holding closures that reference the removed iframe.
The mechanism lens sharpened the harm: each leaked listener's handler calls the
RPC `wrapper`, which inserts a fresh `pendingCallbacks` entry and `postMessage`s
into the dead iframe — a no-op that never resolves, so `pendingCallbacks` grows
UNBOUNDEDLY on every matching DOM event after unload (strictly worse than M7's
static per-cycle retention).

**Impact / trigger.** Per plugin toggle/enable/disable/import/delete,
`loadV3Plugins` unloads-all then re-executes-all, leaking every document listener
and observer any mainDom-permitted V3 plugin registered. Each leaked
high-frequency listener (mousemove/scroll/pointermove are in the unlimited-allowed
list) keeps firing, and each leaked observer keeps firing on host DOM mutations
(the chat stream mutates the DOM constantly), posting into a dead iframe. Severity
corrected medium → low: grows per plugin-MANAGEMENT action (not per routine
send/render); double-gated (V3-plugin usage + the mainDom consent grant for the
document-listener arm; the observer arm is ungated but still V3-plugin-only); no
crash, no data loss; reset on page reload.

**Verifier notes.** The v3-M7 planned fix is narrowly "store `run()`'s cleanup
closure on `SandboxHost`; invoke from `terminate()`" — that removes ONLY the single
`window` `message` listener (`factory.ts:586`), lives entirely in `factory.ts`,
and cannot disconnect a `SafeMutationObserver` (no API exists). A separate cleanup
site in `v3.svelte.ts` is genuinely needed.

**Fix.** Have `SandboxHost` (or the V3 plugin instance) own a teardown registry:
sweep `#eventIdMap` and `document.removeEventListener` all entries on unload; add a
`SafeMutationObserver.disconnect()` method and register each created observer with
the plugin instance. Auto-register both via `addPluginUnloadCallback` in
`getRootDocument`/`createMutationObserver`, draining them in `unloadV3Plugin` the
way `pluginUnloadCallbacks` are drained.

## L38 — DPoP keypair IndexedDB eviction → bare-401 session

- Severity: low · Category: stab · Area: client
- Finder: `sweep:indexeddb-quota` (cid S10), claimed low, confidence medium
- Verification: confirmed (lone skeptic, low — "arguably info")
- Novelty: new (no prior item covers keypair eviction, `knownKeyHashes` pinning,
  or the no-self-heal recovery chain; crosses the client-storage/server-auth
  per-file boundary)
- Location: `src/ts/util.ts:1210-1265` (`openKeypairStoreDB`/`saveKeypairStore`/
  `getKeypairStore`, dedicated `indexedDB.open('DPoPDB',1)`);
  `src/ts/storage/fastifyStorage.ts:90-109` (`getKeyPair`, regenerate+save on
  miss), `:190-261` (`checkAuth`, once-per-session `authChecked` guard), `:266`
  (`sharedStorage` singleton); the second singleton
  `forageStorage.realStorage` (`AutoStorage` → `FastifyStorage`,
  `autoStorage.ts:27`, `globalApi.svelte.ts:69`); server
  `server/fastify/src/auth.ts:75` (`registerPublicKey`, `knownKeyHashes` Set cap
  4096, persisted `__known_public_key_hashes.json`), `:141-152` (`verifyAssertion`
  → `unknown-key`); `http.ts:26-31` → bare 401; recovery `routes/auth.ts:24-34`
  (`/auth/status`), `:57-81` (`/auth/login` re-registers).

**What.** The ES256 auth keypair lives in its own IndexedDB (`DPoPDB`), separate
from the localforage stores. The server only trusts public-key hashes seen via
`registerPublicKey`; `verifyAssertion` rejects any assertion whose pub-hash is not
in `knownKeyHashes` with `unknown-key`, mapped to a bare 401. If the browser
evicts `DPoPDB` under quota pressure, `getKeyPair()` finds no key, generates a NEW
keypair, and persists it — but its hash is unknown to the server. Recovery is NOT
automatic mid-session: `checkAuth()` runs the status/register flow only once per
instance (`authChecked` guard); if eviction happens AFTER `authChecked` is true,
every subsequent request gets a bare 401 with no re-registration trigger until a
page reload (which resets `authChecked`) + password re-entry. The verifier
corrected the singleton model: there are TWO independent `FastifyStorage`
singletons each carrying their own `authChecked` flag — module-level
`sharedStorage` (proxy/projection/generation auth) and
`forageStorage.realStorage` (app-data setItem/getItem). Both read the same keypair
from the shared `DPoPDB`, so one eviction regenerates the key for both and BOTH
keep `authChecked=true` and keep signing with the now-unknown key — worse, not
better, than the single-instance framing. A reload resets both.

**Impact / trigger.** Does NOT permanently brick auth — recovery is reload +
re-enter the node password (the password persists server-side in `__password`,
unaffected by client eviction, and `/auth/login` re-registers the regenerated
key). But mid-session eviction degrades every request to an opaque 401 "Auth
required" with no in-app self-heal until a manual reload. The trigger is rare
(requires actual origin-quota eviction of the dedicated `DPoPDB`); no data loss
(corpus lives server-side). Bounded, infrequent, recoverable — low.

**Verifier notes.** No persistent-storage request anywhere — confirmed by code
absence AND an active negative test (`browserLocalSurface.test.ts:47` asserts
bootstrap does NOT call `navigator.storage.persist`). Client IDB does grow
monotonically (hypaVector cache v3-I15, translator/inlay/plugin caches), so the
origin — including `DPoPDB` — is eviction-eligible under global quota pressure.

**Fix.** On a 401/`unknown-key` response, reset `authChecked` and re-run
`checkAuth()` (re-register via `/auth/login`) instead of surfacing a bare 401;
and/or request persistent storage / detect a missing-key regeneration and
proactively re-register before the first request.
