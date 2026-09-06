# Post-Closeout Test Guide Assessments

Date: 2026-09-04

These assessment, gap, attention, and recommendation sections were moved
from `docs/tests/` when the live guides were narrowed to current test
discovery and operation. They are historical review material, not an active
implementation backlog. Revalidate any recommendation against current code
before reopening it.

## `docs/tests/README.md`

### Executive summary

The suite is strongest at the application's highest-risk state and protocol boundaries: durable writes, revisions, optimistic rollback, prompt assembly, provider wire contracts, streaming terminal behavior, bounded imports, backups, memory jobs, stale asynchronous UI work, and accessibility/focus behavior.

Assertions are commonly exact and stateful: request bodies and headers, SSE frame order, SQLite rows and revisions, IndexedDB outbox contents, rollback scope, visible DOM state, and resource cleanup are all checked.

The main weakness is integration depth rather than raw case count. Most frontend tests run in happy-dom with mocked network/storage/browser APIs; most provider tests mock upstream services; and the per-file-serial Playwright suite covers selected built-browser/Fastify/SQLite journeys. The Phase 7 fast-bootstrap matrix now provides isolated response-loss replay, offline replay, event-gap recovery, multi-tab writer takeover, observer promotion, direct-link, and optional-runtime failure journeys. Browser smoke also proves visible settings authoring, local backup restore over a conflicting edit, resynchronization, and reload durability. There is still no normal composer-to-stream-to-durable-reload browser journey, page-crash/reload outbox journey combined with writer transfer, or destructive restore while encrypted outbox work needs quarantine/reconciliation. CI also enforces only a deliberately small UI coverage sentinel, not the much broader frontend or backend coverage maps.

### Major coverage strengths

- Durable state and data integrity. The revision/receipt transaction suites, encrypted pending-mutation outbox, replay/dependency lanes, hydration fences, targeted invalidation, and field-scoped rollback tests are the suite's deepest protection. They exercise response loss, stale writers, concurrent edits, partial success, restart recovery, and real SQLite constraints.
- Prompt and generation contracts. Exact prompt rows, golden local/server-backed fixtures, eligibility matrices, terminal SSE vocabulary, fragmented frames, disconnect/reattach/cancel behavior, and reroll persistence make semantic or message-loss regressions likely to be caught.
- Provider and security boundaries. Every major provider family has request/stream/error/abort coverage. Secret masking, stable identity, fixed-operation allowlists, endpoint binding, SSRF prevention, body/decompression caps, trace redaction, and prototype-pollution cases are especially valuable.
- Recoverability and untrusted content. Backups, `.risu` codecs, bundle import/export, asset hashing/GC, Realm/CharX staging, rollback, size caps, aborts, and historical-format normalization use real files, archives, bytes, and SQLite state rather than only shape mocks.
- Asynchronous UI ownership. Character, media, catalog, modal, settings, memory, translation, and Playground tests consistently guard "latest request wins," target disappearance, stale completion, dirty-field preservation, cancellation, and focus restoration.
- Performance invariants. Clone counts, SQL reads/table writes, cache reuse, parser invalidation, asset loads, and large-corpus request shapes explicitly protect users with large libraries. These assertions are implementation-aware but cover real regression classes.

### Major gaps

- Too few complete browser journeys. The per-file-serial Chromium suite cannot cover the number of independently tested layers. Missing high-value journeys include normal composer streaming and reload, crash/replay, two-tab writer transfer, profile creation-to-generation, Hypa jobs, multi-step loadouts/modules, and destructive backup restore while queued outbox work must be quarantined or reconciled.
- Mocked external and browser behavior. Provider APIs, Web Push, Web Speech/AudioContext, image decoding/canvas/compression, workers, IndexedDB quota/upgrade failure, Web Locks, and most service-worker behavior are simulated. Deterministic unit tests should remain, but bounded opt-in canaries and a few real-browser media/storage cases are needed.
- Coverage and CI governance are narrow. The enforced UI map samples six files with low aggregate thresholds; the much broader frontend/backend maps have no floors or changed-file policy. CI uploads retained Playwright failure traces/results, the startup matrix, and the Phase 7 integration report. Important low-covered seams include browser Hypa implementations, plugin safety/sandbox branches, parsing/script orchestration, some provider adapters, backend CBS/lorebook/trigger effects, Realm card conversion, and several runtime/error branches.
- Duplicated client/server contracts can drift. Capability eligibility, command routes, SSE event names, prompt/lore behavior, preset schemas, and provider option matrices are hand-maintained on both sides. Independent tests provide defense in depth, but shared typed fixtures or parity checks are missing. Persisted asset discovery and local-backup rewriting are the closed exception: they share a narrow owner catalog with explicit parity and arbitrary-JSON negative tests.
- Scale/stress ownership is selective. The 7,000-asset Realm case and render-cost harness now have isolated local/CI lanes, but other large-corpus bounds still rely on their ordinary suite owners. New resource-sensitive contracts need explicit concurrency and schedule decisions.
- Some visible outcomes stop at internal state. Many bridge and command tests assert projections and mocks but do not mount the consuming component. Translation, media, memory, optimistic rollback, and provider-profile changes need selective DOM/browser confirmation.

### Tests requiring attention

- Structural or implementation-coupled checks: `AccessibleIconActions`, several Bot/character/module/editor accessibility gates, `browserLocalSurface`, source-text bridge assertions, clone-count probes, exact epoch/cache/read-count tests, and terminal-oracle tests. Some are useful architecture policy; they should be labeled as such and paired with behavior assertions rather than treated as user-outcome evidence.
- Very large suites: browser `commands.test.ts`, `chatCommands.test.ts`, `storage/database.svelte.test.ts`, `TranslatorPresetSettings.svelte.test.ts`, the `DefaultChatScreen*.test.ts` family, `SideChatList.svelte.test.ts`, and backend `generation.chat.test.ts`/`assemble.test.ts` combine many concerns and dense shared mocks. Their scenarios are mostly valuable, but failure diagnosis and safe fixture changes are difficult.
- Repeated race/focus matrices: latest-operation upload tests, modal focus/Escape checks, dirty-field rollback, and route allow/deny tables repeat setup across domains. Consolidate shared contracts without deleting ownership-specific cases.
- Browser failure isolation: the visible-state journeys now synchronize on command responses, applied revisions, lineage conflict, navigation, document reload, and settled DOM/store state, and attach recent console/page errors on failure. The first Fastify browser smoke remains a long, monolithic journey whose failure location can be hard to interpret.
- Conditional/resource-sensitive gates: keep the direct-only Realm scale, render, and load-cost harnesses under controlled concurrency.
- Narrow tests: several icon/DropList/supporter/static token/source-presence checks prove only one mapping or markup fact. Keep them cheap, but do not count them as substitutes for interaction or accessibility-name computation.
- Global test doubles: the Vitest baseline now installs the production clone helper, with native/fallback semantics and global-restoration behavior locked by tests. It still mocks KaTeX to an empty module; retain at least one non-mocked math-rendering integration.
- Shared browser fixture state: two Playwright specs reuse one Fastify/SQLite fixture across their serial cases. This is efficient but order-coupled. A common fixture with explicit per-test state ownership/reset would make failures easier to reproduce.
- Explicit resource composition: migrated Fastify suites use `injectComposedResourceDatabase` only when they need an assembled read-after-write view. The real bootstrap response remains unmodified and has no synthetic `database` property; new tests should prefer the narrow resource reader that owns the behavior.

### Prioritized recommendations

1. Add the remaining end-to-end reliability journeys. First: real composer submission → incremental stream → durable completion → reload. Second: stage a durable edit → lose the response/kill the page → reload and replay exactly once, with a two-tab writer-transfer variant. Third: extend the existing visible backup-restore/reload proof by staging encrypted outbox work before restore and asserting quarantine/reconciliation.
2. Strengthen CI governance. Keep the fast UI sentinel's production-only denominator and add realistic per-area or changed-file floors for high-risk frontend/backend code. Keep Playwright artifacts plus isolated Realm/performance lanes as required owners.
3. Replace remaining fixed timing and improve failure isolation. Use observable barriers in backup/abort, Lua, worker, and remaining browser/server tests; keep parameter rows behavior-oriented and uniquely named; split monolithic browser smoke while preserving its cross-layer assertions.
4. Create shared parity contracts. Generate or share typed fixtures for client/server provider capability, durable routes, SSE event vocabulary, prompt/lore parity, and preset schemas while preserving boundary-specific assertions; keep the completed persisted-asset owner catalog parity gate current.
5. Target uncovered high-risk semantics. Prioritize CBS/lore/trigger effects, similarity ranking with malformed/mixed vectors, Realm card conversion variants, plugin sandbox/safety branches, cache limits/quota failures, and provider error/content-block variants over indiscriminate global percentage increases.
6. Refactor the test architecture. Split mega-suites by behavior, centralize durable-command/race/focus harnesses, replace source-string checks with mounted behavior or one explicit static architecture gate, and retain exact state/DOM assertions in domain-owned tests.
7. Add bounded integration canaries. Use sanitized recorded upstream responses and optional live provider/media/Push canaries with strict cost, secret, timeout, and network controls. They should supplement—not make flaky—the deterministic default suite.

## `docs/tests/api-security-and-runtime.md`

### Coverage gaps and recommendations

- Extend the malformed auth matrix across JWT algorithm/key/payload identities and add proxy-derived client-IP/trust-proxy combinations. The loopback-only development bypass and reviewed public-route exceptions are now pinned.
- Replace the relative resource-payload assertion with explicit reviewed byte ceilings while retaining the shell-vs-hydration semantic assertions. Large import/export streaming and materialization have their own bounded route and archive tests.
- Make route enumeration structural rather than parsing `printRoutes()` text if Fastify offers a stable hook/registry.
- Replace fixed millisecond sleeps and tiny real-time aborts with server/test barriers or condition polling; keep a small number of real deadline integration cases.
- Publish backend coverage in CI or add narrow thresholds for security-critical modules. The ordinary server lane has no coverage gate.
- Preserve the explicit self-hosted generic-proxy compatibility decision: generic first-party proxying remains broader than permissioned plugin and local-stream egress, while all three require authentication and bounded lifecycle handling.

## `docs/tests/app-navigation-and-chat.md`

### Attention and gaps

- `MobileControls.svelte.test.ts` was removed during the effectiveness audit:
  it mounted `MobileHeader` and `MobileBody`, but those legacy shell components
  are explicitly not mounted by `App.svelte`. Their back/menu/tools assertions
  therefore could not fail for a live responsive-navigation regression. The
  mounted App route/focus cases and real responsive Chromium controls retain the
  current product contract. The orphaned legacy test state was deleted; the
  shared stub remains because the live `MobileCharacters` owner still consumes
  it.
- Add a real browser journey that types in the composer, attaches a file, sends through Fastify, observes streaming/abort, and reloads the persisted transcript.
- Replace fixed Playwright sleeps with observable command revision, request completion, or settled DOM conditions. Add a true mobile/touch project and consider Firefox/WebKit for focus/file behavior.
- Split the largest fixtures by the logical groups above and share typed setup; retain deferred races and DOM oracles.
- Sample actual clipboard, selection, IME, pointer, and partial-edit long-press behavior in a real touch browser.
- Keep performance call-count tests explicitly labeled; do not treat them as substitutes for rendered output assertions.

## `docs/tests/assets-import-export-and-backups.md`

### Coverage gaps and recommendations

- Keep the isolated user/CI Realm-scale owner and its single-worker job aligned with Realm changes; the ordinary server lane intentionally records one skip.
- Grow a curated corpus of historical and malformed `.risu`, `.bin`, bundle and SQLite artifacts from real bug reports. Current block/ZIP/SQLite fixtures are synthetic or current-code-derived; never substitute the missing pinned baseline or refresh goldens to manufacture independence.
- Propagate request `AbortSignal` through post-upload archive decode, durable import application, and CharX extraction, with observable staging barriers instead of timing sleeps.
- Define streaming/materialization policy for large ordinary and bundle exports and for the legacy browser ZIP/Realm fallbacks. Current metrics and caps protect important boundaries but do not bound every hydrated corpus or expanded browser archive.
- Extend the built-browser restore journey with queued encrypted outbox work, artifact/reference inspection, and a bounded mid-import disconnect. Existing smoke proves ordinary visible restore/resynchronization/reload durability, while backend tests own deep conversion and cleanup.

## `docs/tests/browser-state-sync-and-recovery.md`

### Assessment

This is one of the suite's strongest and most important areas. Tests repeatedly enforce the core safety
rule: an accepted revision is either acknowledged against the exact, still-current
optimistic projection or reconciled through an authoritative read. They also cover unsent mutations
through persistence, response loss, dependency ordering, writer changes, and terminal rejection.

Assertion quality is high. Most cases verify request headers and bodies, retained IndexedDB rows,
revision cursors, resource values, projection epochs, and whether a fallback read did or did not occur.
The largest limitation is layer realism: most browser tests use happy-dom, mocked fetch and subsystem
seams, fake IndexedDB, and fake timers. They do not prove a complete crash/reload journey across a real
browser, Web Locks, Fastify, SQLite receipts, SSE replay, and rendered state.

The Phase 0 and Phase 7 Playwright matrices now provide stronger cross-layer evidence than this area
previously had: isolated small/large cold/warm startup, offline-before-send and response-lost-after-commit
replay, a real replay-window gap, two-context denial/takeover/promotion, observer flag-off/on boundaries,
every route-manifest direct-link family, and slow/failing optional resources with Retry. They still do not
simulate a browser process crash or combine a persisted outbox row with a second-tab ownership transfer.

### Attention, gaps, and recommendations

1. Add a real-browser crash/reload journey with real IndexedDB and Web Locks: stage an edit, terminate
   between durable write and response, reload/adopt the correct writer, replay exactly once, acknowledge
   the receipt, and verify the rendered value. Add a response-loss and second-tab predecessor variant.
2. Integrate destructive restore/import with retained old-lineage intents and receipt ACKs. Verify no
   cross-lineage replay, correct quarantine/disposal, full refresh, hydration reset, and visible
   selection preservation. Save/restore route details belong in the assets/saves document.
3. Exercise the resource cache's 512-manifest, 32,768-entry, total-byte, and per-value limits, pruning
   order, quota failure, database upgrade interruption, and unreadable rows. Confirm full GET fallback and
   that cached data is never used without authenticated hash confirmation.
4. Parameterize command-event SSE parsing over arbitrary byte chunks, UTF-8 splits, CRLF, comments/
   heartbeats, clean close, and abort during frame delivery.
5. Add rendered optimistic-and-rollback transitions for representative character, message, persona,
   prompt-item, and loadout mutations. The UI documents should own those DOM assertions.
6. Split the large command test by transport, queue/retry, local acknowledgements, and domain adapter
   families. Generate durable route parity from a shared catalog while keeping adversarial near misses.
7. Keep clone-count tests as explicit architectural gates. They protect real large-corpus regressions but
   should not be the only assertion for a user-visible behavior.

## `docs/tests/character-content-memory-and-catalogs.md`

### Attention and gaps

- Add one browser content-authoring journey through Fastify: edit ordinary character fields, create/edit/delete one lore or trigger row, reload, and run the saved definition in generation/display.
- Replace CharConfig source-level picker-token and control-name checks with delayed picker interactions and computed accessible-name assertions.
- Exercise Trigger V2 drag/move on a real touch-capable browser and add a save/reload/runtime round trip.
- Add a live Hypa job/create/cancel/reopen browser journey and a Realm search/import/report journey; current network/job layers are mocked.
- Add focused full-page coverage for `GlobalLoreBookSettings.svelte` and ordinary name/description/first-message persistence.

## `docs/tests/domain-mutations-and-editing-bridges.md`

### Assessment

Coverage is unusually deep around the failures that most often cause browser
data loss: index shifts during an await, owner switches, a second local edit overtaking the first,
authoritative projection replacement, retryable durable retention, terminal rollback, partial success in
a command sequence, and rollback that must touch only fields still equal to the failed attempt.

Assertion strength is high. Tests normally assert the immediate optimistic value, exact command payload,
durable ordering or result classification, and final rollback/retained state while checking that sibling
rows and newer edits survive. The main limitation is that many cases stop at resource state or mocked
command calls. Only part of the prompt owner suite mounts real Svelte UI; most character, chat, persona,
loadout, module, lorebook, and script rollback behavior lacks a rendered-state assertion.

### Attention and gaps

- The current explicit owners execute resource-state or mounted behavior and no
  longer read their production source. Companion checks in
  `src/lib/_audit/frontendArchitecture.static.test.ts` still use source text for
  explicit wiring policy; do not count those static policies as runtime proof.
- Large files repeat deferred promises, command receipts, projection epochs, and generic attempted-field/
  keyed-list rollback. `chatCommands.test.ts` is many lines; `storage/database.svelte.test.ts` is 4,928;
  lorebook/prompt/script owner suites are each multi-thousand-line. The scenarios are mostly valuable,
  but shared harnesses would make failures easier to diagnose.
- Historical work-item identifiers such as “Phase”, “Lxx”, “Mxx”, “K4”, and “P1” do not belong in test
  titles. Name tests for the behavior, scope, or performance contract they protect.
- Clone-count and exact snapshot-boundary assertions protect real large-corpus regressions but are
  intentionally coupled to implementation. Preserve a dedicated performance gate and also assert user
  outcomes.
- Most tests mock the transport and do not mount the consuming component. Cross-link chat, settings,
  sidebar, model, and plugin UI tests, and add DOM coverage where no visible-state test exists.
- Import and upload byte handling is deliberately not repeated here. Character card, Realm, backup,
  binary asset, and inlay details belong in the assets/saves document.

### Prioritized recommendations

1. Add mounted optimistic-then-rollback tests for one character field, one chat message edit/delete, one
   persona selection, one prompt item, one loadout apply, one module toggle, and one lorebook entry. Assert
   both the optimistic paint and the visible rollback or authoritative replacement.
2. Add a browser-to-Fastify integration for a multi-step loadout or module import: verify queue ordering,
   partial success, retained suffix, reload replay, resource reread, and final rendered state.
3. Keep component wiring policies centralized in the named static architecture
   gate, and retain mounted behavior as their runtime companion.
4. Build shared parameterized contracts for latest-operation freshness and attempted-field/keyed-list
   rollback. Retain domain-specific ownership, stable-ID, payload, and projection cases.
5. Split the largest files by product behavior while reusing fixtures: chat structures/messages/settings;
   preset hydration/mutation/replay; lorebook draft/modal/watcher; script classifier/draft/watcher.
6. Cross-link model/Agent Preset validity, asset/import transport, plugin/MCP permissions, scripting
   execution, and rendered UI documents so this file does not imply end-to-end coverage it does not own.

## `docs/tests/memory-and-embeddings.md`

### Assessment

Memory is one of the best-layered subsystems in the suite. Pure planners and ranking functions, SQLite repositories, provider adapters, job handlers, the worker, Fastify routes, browser adapters, and Svelte controls all have targeted coverage. Failure, cancellation, stale-response, idempotency, rollback, and bounded-work cases are unusually prominent. The primary risks are semantic drift between the legacy and Hypa paths, lower branch coverage in similarity ranking and read routes, and the absence of a production-browser journey that lets a real job progress through summary creation, embedding, selection, editing, cancellation, and prompt use.

### Attention and gaps

- Add a Playwright journey that enables Hypa, starts summary/embedding work, observes live progress, edits a summary, cancels or retries a job, reloads, and verifies the selected memory appears in prompt preview. This would connect seven well-tested layers that are currently isolated.
- Expand similarity-ranking cases around corrupt/mixed vector dimensions, zero-norm values, multi-query ties, and partial provider output. Target the uncovered semantics, not a percentage alone.
- Establish shared legacy/Hypa prompt-placement fixtures for the compatibility scenarios both paths claim to preserve.
- Add opt-in recorded or live canaries for supported embedding and summary providers. Keep credentials and network-dependent checks outside the deterministic default suite.
- Consolidate repeated modal focus/escape setup into shared helpers while retaining assertions on visible state, the active element, and persisted patches.
- Keep scheduler/load-cost assertions as explicit performance gates; document intentional bound changes rather than weakening them during refactors.

## `docs/tests/persistence-commands-and-events.md`

### Coverage gaps and recommendations

- Split `commands.test.ts` by the behavior groups above while retaining shared harnesses. Rename phase-code-first suites to behavior-first names; phase IDs can remain suffixes.
- Consolidate range/floor/ceiling/read-budget setup into a declarative command matrix that records route, required reads, permitted writes, fallback and event shape. Preserve route-specific semantic tests separately.
- Add tracked historical SQLite/database fixtures alongside the synthetic migration schemas, particularly for receipts, event history, extracted messages/Hypa and split presets.
- Treat command timing metrics as diagnostics unless explicit, stable ceilings are added. Do not describe nonnegative timings as performance gates.
- Add targeted `splitPresets` cases before changing its normalization branches; do not chase a global percentage without realistic fixtures.
- Continue requiring the strong negative oracle—no revision, event, receipt, or unrelated write—whenever a command rejects input or a transactional persistence step fails.

## `docs/tests/playground-and-specialized-tools.md`

### Attention and gaps

- Add at least two real Chromium journeys: image file select/canvas region/result rendering and subtitle file/transcription/cancel/download. Add Firefox/WebKit where codec and Blob behavior differs.
- Add a Playground MCP journey against a deterministic local server, including refresh, duplicate names, one tool execution, cancellation/error, and permission/OAuth boundary as applicable.
- Exercise contenteditable parser/syntax input, file conversion, inlay preview URLs, and actual download behavior in a browser.
- Add an Iris conversation/tool round through the visible modal and persisted reload; avoid relying only on exposed component methods.
- Keep async ownership fixtures shared and typed, but do not replace per-tool visible error/retry assertions with generic helper tests.

## `docs/tests/plugins-modules-and-mcp.md`

### Assessment

Coverage is deep at the security, cancellation, lifecycle, and optimistic-state seams. The suite repeatedly checks that permissions are bound to the exact plugin identity/script/capability, stale async work cannot mutate a replacement runtime or RisuAccess owner, private targets are rejected, and unload releases listeners, delayed keyboard callbacks, timers, observers, providers, MCP registrations, and pending RPC work. MCP tests similarly cover failed handshakes, expired sessions, header and JSON-body deadlines, standard SSE line framing and parse errors, duplicate response IDs, listener cleanup, bounded buffers/list pagination, and stable dispatch identities.

The main caveat is environment realism. Most Plugin V3 sandbox and MCP transport tests run in happy-dom with mocked windows, frames, transports, and permission prompts. They strongly prove local logic but cannot fully validate a production browser's iframe CSP, cross-window structured-clone/transfer behavior, network stack, or interoperability with real MCP servers.

### Attention and gaps

- Add a maintained Chromium integration test that loads a minimal Plugin V3 iframe, verifies effective CSP/network blocking, performs RPC with transferable/cyclic data, unloads it, and proves all registrations/listeners are gone. A Phase 10 probe already showed active SVG rendered through the real icon component issues no requests/script and opaque guest blobs are refused; retain that as evidence until a tracked lane supersedes it.
- Add a local standards-conformant MCP test server for discovery, OAuth renewal, SSE/streamable HTTP, duplicate tool names, tool results with text/image/resource content, cancellation, and reconnect.
- Generate the shared protected-host and plugin-capability matrices from exported protocol catalogs. Keep adversarial spelling/encoding cases explicit.
- Split `src/ts/plugins/plugins.test.ts` by runtime lifecycle, import/update, and database bridge. Its cases are strong but the mixed harness makes ownership difficult.
- Expand Google Search/internal client behavior beyond credential non-persistence, or explicitly mark unsupported server-backed paths as compatibility gates.
- Keep snapshot updates for RisuAccess module output paired with a semantic field diff; a large snapshot should not be the only signal for a tool-schema change.

## `docs/tests/prompting-generation-and-streaming.md`

### Assessment

This is one of the suite's strongest and most important areas. Pure prompt builders use exact-output assertions, client/server routing tests exercise supported and rejected intent matrices, and golden fixtures compare complete assembled prompts. The durable-generation and stream tests cover failures that would otherwise lose messages or leave chats permanently busy. The main limitation is that most browser-side generation tests replace the API, provider, tokenizer, scripting, or render layer with controlled doubles. Only the sparse Playwright suite crosses a production browser, Fastify, SQLite, SSE, and rendered-chat boundary, and it does not submit a normal composer message through a real streamed provider response.

### Attention and gaps

- Add one Playwright journey that types into the real composer, submits, observes incremental token paint, waits for durable persistence, reloads, and verifies the final row. The current smoke generation calls the API directly.
- Create shared client/server tables for provider capability, server-assembly eligibility, SSE event names, and representative prompt parity. Today, duplicated matrices provide useful defense in depth but also a maintenance trap.
- Add sync/async lorebook parity cases for every decorator/directive/budget/recursive scenario. This is more valuable than indiscriminately raising global coverage.
- Break up the very large server files: `generation.chat.test.ts`, `assemble.test.ts`, and related multi-thousand-line harnesses. Preserve shared fixtures, but organize by durable lifecycle, prompt assembly, post-processing, and preview.
- Replace phase-code-first case names with behavior-first names. Phase IDs can remain as suffixes for historical traceability.
- Keep golden fixture updates review-gated and show a semantic prompt-row diff when possible.

## `docs/tests/providers-models-and-media.md`

### Assessment

The provider suite has excellent contract-level breadth. Tests assert selected model/profile precedence, URL, headers, credentials, body fields, multimodal conversion, streaming frames, finish/error metadata, aborts, byte limits, and secret redaction for every supported provider family. The model-profile tests are similarly thorough across durable and legacy resolution. This makes accidental credential exposure or a wrong wire shape unlikely to pass unnoticed.

The unavoidable weakness is upstream realism. Normal tests replace all commercial services with mocked fetches or local echo servers. They can prove what RisuAI sends and how it parses recorded shapes, but not that an upstream API still accepts the request today. Browser audio/canvas/image/worker behavior is also largely mocked. There is no opt-in recorded/live provider canary lane and no non-Chromium media journey.

### Attention and gaps

- Add an opt-in canary lane using sanitized recorded responses and, where credentials are available, tightly bounded live requests. Version fixtures by upstream API date/model family.
- Add one cross-layer profile journey: create and bind in the browser, reload masked resources, resolve the role, generate through Fastify, and prove the key never appears in browser state or traces.
- Generate capability/profile option parity from shared typed fixtures while retaining provider-owned request assertions.
- Add real Chromium media tests for representative PNG/JPEG orientation/transparency, audio decode/stop/autoplay, PCM wrapping, and image object-URL cleanup; add Firefox/WebKit where feasible.
- Target uncovered backend semantics in generation tools, chat dispatch, and less common provider branches rather than chasing a global percentage.
- Expand cache expiration/eviction and credential-rotation cases for all dynamic provider catalogs.

## `docs/tests/scripting-parsing-and-automation.md`

### Assessment

The parser tests are compact and valuable: most feed concrete source text to production parsers and assert exact output, including nested control flow, whitespace, escaping, recursion, and budget failures. Trigger/script tests are strongest where they prove durable writes through explicit owners, bounded execution, scoped rollback, cache behavior, and server-side Lua security. Phase 9 added recursion propagation, regex complexity/output bounds, recoverable Lua/Python deadlines, UTF-8 response limits, nested Trigger V2 validation, and collision-free script cache identities. Large legacy trigger/CBS engines still have many branches, client and server implementations lack a comprehensive parity table, and editor/UI tests do not exercise every runtime effect they can author.

### Attention and gaps

- Build a shared CBS compatibility matrix for browser and server adapters: supported value, rejected host-only callback, fallback value, mutation behavior, and error semantics.
- Add table-driven coverage for the missing V2 trigger data operations rather than another broad happy-path trigger fixture.
- Run a saved regex/trigger/Lua definition from its real editor through persistence, reload, and generation/display in one browser journey.
- Expand Python worker tests to real worker startup/termination, abort/deadline, multiple concurrent calls, large/error results, and context replacement.
- Separate behavior assertions from explicit performance gates where the same test currently asserts both exact output and clone/cache internals.

## `docs/tests/settings-profiles-and-extensions.md`

### Attention and gaps

- Add one real browser settings journey: edit a debounced value, navigate away to force keepalive flush, reload after SSE reconciliation, then preserve/replace/clear a masked secret.
- Replace raw source-string/count checks in Bot/OtherBot/ModuleMenu with compiled AST rules plus representative mounted interactions; exact counts such as “27 sliders” are brittle.
- Split `TranslatorPresetSettings` and other remaining mega-suites by the logical groups above using common typed harnesses.
- Add focused contracts for currently indirect pages such as `UserSettings.svelte`, `AccessibilitySettings.svelte`, and `LanguageSettings.svelte`.
- Keep outbox/receipt implementation assertions, but label them architecture contracts and pair them with visible DOM outcomes.

## `docs/tests/shared-ui-feedback-and-accessibility.md`

### Attention and gaps

- Add automated complete-screen accessibility checks for onboarding, Settings, chat, catalog, and a complex nested modal; retain targeted keyboard tests for ownership details.
- Extend the AST icon policy with rendered computed-name/activation cases when a shared action lacks a mounted owner.
- Add a real browser onboarding flow and stacked confirm/input/select alert flow. Add true mobile/touch and Firefox/WebKit coverage for focus, file, and viewport behavior.
- Add general language placeholder/formatter parity across all seven languages and representative long translated-label rendering.
- Broaden `coverage:ui-map`: it currently excludes `src/lib/UI`, Setting, Playground, Mobile, App, language, and GUI runtime files and repeats only six selected component files. Its low aggregate thresholds make it a smoke sentinel, not comprehensive coverage.

## Deferred compatibility retirement note

At cleanup time, `POST /api/v1/characters/aggregate` remained an external
compatibility route with no first-party production consumer. Its former live
guide note proposed removal after path telemetry recorded zero supported-client
requests for 30 consecutive days. No active plan currently owns that retirement.

## Additional introductory assessments

The following assessment paragraphs originally appeared before the first
section of their live test guides.

### `docs/tests/api-security-and-runtime.md`

Assertions in this area are generally strong: most route tests check exact status/body/headers and upstream calls, while security tests also check that parsing, forwarding, or mutation did not occur. Phase 12 added independent route-exception oracles, loopback-only development auth bypass, symlink-safe sandbox replacement, DNS-pinned local streaming, disconnect cleanup, malformed-frame rejection, and explicit output/lifetime/snapshot ceilings. The remaining gaps below are bounded follow-up work rather than unowned security assumptions.

### `docs/tests/app-navigation-and-chat.md`

The suite is strongest on stale async ownership and optimistic visible state. Complex tests routinely defer hydration, commands, translation, file selection, or confirmation, then assert that the originally clicked chat/message remains the target and that failure restores both state and DOM. Its main weakness is integration depth: large Happy DOM harnesses mock routing, command, parser, and hydration layers, while the real-browser suite is Chromium-only and often uses test helpers or direct API calls for setup.

### `docs/tests/assets-import-export-and-backups.md`

This area has strong real-file, SQLite, archive, hashing, bounded-stream and rollback coverage. Phase 11 additionally closed ambiguous archive/block framing, portable reroll loss, legacy backup-reference drift, and failed CharX asset cleanup. Current coverage unifies persisted-asset discovery and local-backup rewriting behind one narrow catalog, streams imported ZIP/legacy assets through bounded `.part` staging with incremental hashes, propagates aborts through post-upload staging and pre-commit checks, and includes a visible browser backup-restore/reload journey. Its remaining gaps are independent historical fixture provenance, real encrypted-outbox reconciliation during restore, and bounded large-corpus/browser composition—not the route-level import envelope.

### `docs/tests/character-content-memory-and-catalogs.md`

Coverage is strongest where a delayed picker, confirmation, hydration, translation, or command could apply to a replacement character, row, message, or summary. Stable-ID targeting and optimistic rollback are consistently asserted. The main gap is a lack of real-browser create/edit/delete journeys through Fastify; several character control/token checks inspect source rather than interacting with rendered controls.

### `docs/tests/persistence-commands-and-events.md`

This is the backend suite’s strongest data-integrity area. High-value tests routinely combine four or more oracles: HTTP result, revision and event, persisted JSON/SQLite rows, and absence of writes to unrelated rows/tables. The principal maintenance concern is concentration: `commands.test.ts` remains a very large multi-domain suite, while several performance families repeat similar harness setup and assert implementation-level SQL/table behavior.

### `docs/tests/playground-and-specialized-tools.md`

The suite is strong on stale request ownership, cancellation, cleanup, retry, control naming, and partial-success behavior. The production-browser first-open matrix now opens every Playground route against its real emitted JavaScript/CSS entry and covers delayed, offline, and stale assets. It remains weakest where the browser is the product after loading: canvas selection, Blob URLs, codecs, AudioContext, downloads, contenteditable, file pickers, workers, and MCP transport are still mocked.

### `docs/tests/settings-profiles-and-extensions.md`

The suite is exceptionally strong on optimistic edits, debounced/lifecycle flushes, command ordering, rollback, authoritative projection convergence, and stale dialog ownership. Its biggest liabilities are a handful of source-text assertions and several very large mock-heavy component suites. There is no browser journey that edits a representative setting or secret through Fastify and observes the final masked/reconciled UI.

### `docs/tests/shared-ui-feedback-and-accessibility.md`

The suite is notably strong on focus containment, safe initial focus, Escape ownership, opener restoration, stale async results, and accessible names. Its weakest tests inspect source strings rather than the rendered accessibility tree, and Happy DOM cannot validate browser focus, touch, geometry, media autoplay, canvas, or visual layout exactly. There is no automated complete-screen accessibility scan.
