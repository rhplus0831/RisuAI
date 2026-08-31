# Test Suite Guide

Last audited: 2026-08-29.

This documentation groups the current suite by protected product behavior. Treat `package.json` and the runner configuration files as the source of truth for commands and discovery; this guide intentionally avoids snapshot case counts and pass totals, which become stale whenever tests are added or parameterized matrices change.

## Executive summary

The suite is strongest at the application's highest-risk state and protocol boundaries: durable writes, revisions, optimistic rollback, prompt assembly, provider wire contracts, streaming terminal behavior, bounded imports, backups, memory jobs, stale asynchronous UI work, and accessibility/focus behavior.

Assertions are commonly exact and stateful: request bodies and headers, SSE frame order, SQLite rows and revisions, IndexedDB outbox contents, rollback scope, visible DOM state, and resource cleanup are all checked.

The main weakness is integration depth rather than raw case count. Most frontend tests run in happy-dom with mocked network/storage/browser APIs; most provider tests mock upstream services; and the per-file-serial Playwright suite covers selected built-browser/Fastify/SQLite journeys. The Phase 7 fast-bootstrap matrix now provides isolated response-loss replay, offline replay, event-gap recovery, multi-tab writer takeover, observer promotion, direct-link, and optional-runtime failure journeys. Browser smoke also proves visible settings authoring, local backup restore over a conflicting edit, resynchronization, and reload durability. There is still no normal composer-to-stream-to-durable-reload browser journey, page-crash/reload outbox journey combined with writer transfer, or destructive restore while encrypted outbox work needs quarantine/reconciliation. CI also enforces only a deliberately small UI coverage sentinel, not the much broader frontend or backend coverage maps.

The
[Frontend Test Architecture record](../../.archived-docs/performance-and-stability/frontend-test-architecture/status.md)
explains the completed migration to explicit Node, Svelte+Node, DOM, and
built-browser capability ownership. The commands and routing documented below
are authoritative.

The completed
[Test Suite Effectiveness Audit](../../.archived-docs/performance-and-stability/test-suite-effectiveness-audit/status.md)
preserves the review decisions and verification history. Its case-count,
effectiveness, and support manifests are frozen historical records.

## Index

### Product flows and UI

- [App Navigation and Chat](app-navigation-and-chat.md) — routing, character-folder opening, floating composition, chat lists/reset, rerolls, responsive navigation, and browser smoke.
- [Settings, Profiles, and Extensions](settings-profiles-and-extensions.md) — settings pages, model/profile editors, profile/preset reordering, modules/plugins, translators, personas, and Agent Preset UI.
- [Character Content, Memory, and Catalogs](character-content-memory-and-catalogs.md) — character editors, lore/scripts, Hypa controls, Realm/catalog and mobile character behavior.
- [Shared UI, Feedback, and Accessibility](shared-ui-feedback-and-accessibility.md) — alerts, drag-safe backdrop dismissal, dialogs, generic controls, focus, onboarding, feedback, and platform surface gates.
- [Playground and Specialized Tools](playground-and-specialized-tools.md) — Playground execution, conversion, media, parser, translation, MCP, and developer tools.

### State, data, and platform

- [Browser State Sync and Recovery](browser-state-sync-and-recovery.md) — bootstrap, writer identity, encrypted outbox, replay, hydration, invalidation, refresh, and stale-state fences.
- [Domain Mutations and Editing Owners](domain-mutations-and-editing-bridges.md) — optimistic character/chat/settings/preset/persona/loadout/module/lorebook/script edits and rollback.
- [Persistence, Revisioned Commands, and Events](persistence-commands-and-events.md) — SQLite repositories, migrations, identity repair, revisions, receipts, command transactions, secret-preserving state changes, events, projections, and resource reads.
- [API Security, Runtime, and Network Boundaries](api-security-and-runtime.md) — auth, body limits, SSRF/egress policy, tracing/redaction, Web Push, startup/shutdown, and operational routes.
- [Assets, Import/Export, and Backups](assets-import-export-and-backups.md) — assets, garbage collection, save codecs, backup/restore, bundles, bounded high-cardinality Realm/CharX imports, browser uploads, and compatibility adapters.

### AI behavior and extensibility

- [Prompting, Generation, and Streaming](prompting-generation-and-streaming.md) — prompt construction, CBS history/index semantics, preflight, generation, SSE, durability, reroll, Agent Presets, and cost gates.
- [Providers, Models, and Media](providers-models-and-media.md) — model profiles, Strip CoT, translation, image/audio/transcription, and codecs.
- [Provider Adapter Conformance](providers-models-and-media.md#test-groups) — dispatch options, request/response shaping, catalogs, streams, aborts, and errors across first-class, local, legacy, free-model, and compatibility transports.
- [Credential and Secret Integrity](providers-models-and-media.md#test-groups) — stored and draft credentials, masking, stable identity, stale inline-secret migration, endpoint binding, sanitized projections, and provider-operation boundaries; command-side preservation is covered by [Persistence, Revisioned Commands, and Events](persistence-commands-and-events.md#command-api-behavior-inventory).
- [Memory and Embeddings](memory-and-embeddings.md) — Hypa planning, summaries, embeddings, ranking, job execution, worker/API/browser reconciliation, and memory UI.
- [Scripting, Parsing, and Automation](scripting-parsing-and-automation.md) — CBS, regex scripts, triggers, Lua, HTML/chat parsing, templates, and bounded execution.
- [Plugins, Modules, and MCP](plugins-modules-and-mcp.md) — plugin permissions/sandboxing, module lifecycle, MCP transports/OAuth/tools, and RisuAccess resources.

## Running the suite

The canonical command inventory and lane semantics are in
[Testing And Operations](../structure/testing-and-operations.md#scripts).

| Goal | Command |
| ---- | ------- |
| Agent-focused test or related-source feedback | `pnpm test -- <one-test-or-source-file>` |
| User-owned full local quality aggregate | `pnpm test:all` |
| Full pinned compatibility differential | `pnpm prepare:compat-baseline && pnpm test:compat-harness` |
| Startup rollout evidence | `pnpm verify:fast-bootstrap:phase7` |

Agents may use only the focused command, only when it answers a concrete
implementation question. It accepts exactly one repository file, rejects
directories, globs, and arbitrary runner flags, runs exact tests in their owning
runtime, and uses Vitest related-test discovery for source files. Shared
protocol/core sources query both frontend and server projects. A selected
browser-smoke spec performs its required build and runs only that spec.

Agents do not run affected, broad lane, coverage, compatibility, smoke-suite, or
aggregate commands at handoff. The user and CI own periodic full-suite execution
and result review. Agent handoffs record the one focused command that ran, or
state that no tests were run.

### Compatibility evidence ownership

Compatibility register validation and the current-stack/cluster golden harness
run in `pnpm test:all` and as required PR/`main` Quality jobs. The full pinned
baseline differential is intentionally separate: GitHub Actions runs it every
night at 06:00 UTC and on manual dispatch. Baseline-source comparison tests are
routed only through that full pinned lane, so focused tests do not require an
external worktree. Agents do not launch either compatibility harness; the user
reviews the scheduled/manual evidence.
`pnpm prepare:compat-baseline` uses the repository sibling
`../risu-baseline-71c476e9c` by default; `RISU_COMPAT_BASELINE_ROOT` accepts an
absolute override for CI or another checkout layout.

Do not accept a fixture or golden change by regeneration alone. Run the full
pinned harness normally first and inspect the retained semantic artifacts. Once
the change is intentional and adjudicated, refresh goldens with
`pnpm test:compat-harness -- --update-goldens --reason "<review reason>"`. The
governed command requires the full lane and a nontrivial reason; current-only
runs cannot update goldens.

Review `baseline.json`, `current.json`, `diff.json`, and `cluster10.json`
together. The separate `expected-differences.json` maps each accepted divergent
cell/aspect digest to rationale plus signed decision and inventory IDs; the
harness validates the map against the computed diff and compatibility
registers. Normalizer edits also need positive and negative cases showing that
behaviorally meaningful distinctions are not erased.

Compatibility fixture provenance is tracked in `fixture-provenance.json` and
validated on every harness run, including the pinned baseline, exact ordered
case set, normalization contract, and source-file digests. The governed full
update refreshes those digests and the golden manifest. There is no separate
compatibility fixture-update environment switch.

For local failures, inspect ignored
`fast-bootstrap-results/compat-harness/actual-*.json`. In CI, current-harness
failures upload available mismatch diagnostics, and every scheduled/manual full
run uploads the preparation/run logs that were produced, actual artifacts,
tracked goldens/manifest, expected-difference map, and fixture provenance. Both
artifact classes are retained for 14 days. Triage baseline preparation and
governance/provenance validation separately from request, execution, and
persisted-transcript differences; only refresh tracked expectations after
classifying the change as intentional. Keep the durable explanation in the
reviewed change because CI artifacts expire.

This repository has no separate release workflow or packaged release channel;
source builds use the `main` Quality aggregate and a successful full pinned
differential for the candidate commit as release-equivalent gates. Use the
scheduled full run when it covers the exact `main` commit, or manually dispatch
the workflow at the candidate ref.

### Frontend capability classification

| Class | File ownership | Runtime | Use and retention rule |
| ----- | -------------- | ------- | ---------------------- |
| N | Plain `*.test.ts` by default | Node | Pure TypeScript/JavaScript and injected fakes with no required Svelte client transform or browser behavior. |
| S | `*.svelte-node.test.ts` | Svelte client transform with Node globals | Svelte modules or runes whose behavior does not require DOM globals, mounting, layout, focus, or browser APIs. |
| D | `*.svelte.test.ts`, `*.dom.test.ts`, or a reviewed legacy registration | Svelte plus Happy-DOM | Mounted/visible component behavior and browser-shaped contracts, including accessibility, focus, optimistic paint, rollback, real DOM parsing, and transitive eager browser access. |
| B | Browser-smoke `*.spec.ts` | Built SPA in Chromium against Fastify/SQLite | Cross-layer behavior that requires a real browser, navigation, responsive layout, reload, multi-tab ownership, or durable recovery. |

All Vitest projects reject focused tests. Pre-suffix DOM files that cannot be
renamed without broad churn are explicitly registered in
`vitest.frontend-routing.ts`; these are probe-backed retainers, not an implicit
fallback. Do not add a registration without execution evidence and a reviewed
reason. Explicit suffixes and legacy registrations determine Svelte+Node and DOM
ownership; other `*.test.ts` files default to Node. Use runner discovery for the
current exact file distribution.

Playwright keeps each spec serial, uses two local file workers (one in CI),
retains traces on failure, and sets `forbidOnly` in CI. The normally skipped
7,000-display-asset Realm stress case is enabled by running
`realmImport.test.ts` directly. Broad frontend and backend coverage are
report-only; only the focused UI map has thresholds.

The user-owned `test:all` command defaults to two concurrent outer lanes; override it with
`RISU_TEST_ALL_JOBS=<count>` or `--jobs <count>`, and inspect the schedule with
`--dry-run`. Pass `--timings=json` to append a machine-readable lane schedule
and timing record for critical-path analysis. It waits to build browser smoke
until the independent server typecheck lane has completed. Its ordinary frontend
subprocess omits the six UI-map files, then the coverage lane executes them once
with thresholds after the remaining frontend tests finish. Browser smoke,
server, and performance lanes run outside the outer pool. Smoke uses its own
bounded file-level parallelism; the other isolated lanes contain load-sensitive
checks.

`server/fastify/vitest.config.ts` roots discovery at `server/fastify/` and
includes `__tests__/**/*.test.ts`. `pnpm test -- <file>` selects that config for
server tests and source, while ordinary frontend files use the root three-project
Vitest configuration.

`startupCachePopulationMatrix.spec.ts` keeps small/large and cold/warm startup populations
separate and writes `fast-bootstrap-results/startup-matrix.{json,txt}`.
`startupDirectLinks.spec.ts` runs every production route-manifest direct-link
family in four independently isolated batches. `startupRecoveryIntegrationMatrix.spec.ts`
runs flag-off/on startup, offline and response-loss replay, a real
`event_replay_unavailable` recovery, multi-tab denial/takeover/promotion, and
slow/failing optional-runtime Retry. Per-worker partials are merged after the
Playwright run into `fast-bootstrap-results/phase7-integration.{json,txt}`, with
exact batch and route-index coverage validation. The disposable harness owns a
temporary authenticated Fastify/SQLite instance per journey or direct-link
batch. See
[Development And Observability](../structure/development-and-observability.md#fast-bootstrap-measurement-and-rollout-gate)
for fixtures, budgets, artifact interpretation, and request-trace correlation.

## Major coverage strengths

- Durable state and data integrity. The revision/receipt transaction suites, encrypted pending-mutation outbox, replay/dependency lanes, hydration fences, targeted invalidation, and field-scoped rollback tests are the suite's deepest protection. They exercise response loss, stale writers, concurrent edits, partial success, restart recovery, and real SQLite constraints.
- Prompt and generation contracts. Exact prompt rows, golden local/server-backed fixtures, eligibility matrices, terminal SSE vocabulary, fragmented frames, disconnect/reattach/cancel behavior, and reroll persistence make semantic or message-loss regressions likely to be caught.
- Provider and security boundaries. Every major provider family has request/stream/error/abort coverage. Secret masking, stable identity, fixed-operation allowlists, endpoint binding, SSRF prevention, body/decompression caps, trace redaction, and prototype-pollution cases are especially valuable.
- Recoverability and untrusted content. Backups, `.risu` codecs, bundle import/export, asset hashing/GC, Realm/CharX staging, rollback, size caps, aborts, and historical-format normalization use real files, archives, bytes, and SQLite state rather than only shape mocks.
- Asynchronous UI ownership. Character, media, catalog, modal, settings, memory, translation, and Playground tests consistently guard "latest request wins," target disappearance, stale completion, dirty-field preservation, cancellation, and focus restoration.
- Performance invariants. Clone counts, SQL reads/table writes, cache reuse, parser invalidation, asset loads, and large-corpus request shapes explicitly protect users with large libraries. These assertions are implementation-aware but cover real regression classes.

## Major gaps

- Too few complete browser journeys. The per-file-serial Chromium suite cannot cover the number of independently tested layers. Missing high-value journeys include normal composer streaming and reload, crash/replay, two-tab writer transfer, profile creation-to-generation, Hypa jobs, multi-step loadouts/modules, and destructive backup restore while queued outbox work must be quarantined or reconciled.
- Mocked external and browser behavior. Provider APIs, Web Push, Web Speech/AudioContext, image decoding/canvas/compression, workers, IndexedDB quota/upgrade failure, Web Locks, and most service-worker behavior are simulated. Deterministic unit tests should remain, but bounded opt-in canaries and a few real-browser media/storage cases are needed.
- Coverage and CI governance are narrow. The enforced UI map samples six files with low aggregate thresholds; the much broader frontend/backend maps have no floors or changed-file policy. CI uploads retained Playwright failure traces/results, the startup matrix, and the Phase 7 integration report. Important low-covered seams include browser Hypa implementations, plugin safety/sandbox branches, parsing/script orchestration, some provider adapters, backend CBS/lorebook/trigger effects, Realm card conversion, and several runtime/error branches.
- Duplicated client/server contracts can drift. Capability eligibility, command routes, SSE event names, prompt/lore behavior, preset schemas, and provider option matrices are hand-maintained on both sides. Independent tests provide defense in depth, but shared typed fixtures or parity checks are missing. Persisted asset discovery and local-backup rewriting are the closed exception: they share a narrow owner catalog with explicit parity and arbitrary-JSON negative tests.
- Scale/stress ownership is selective. The 7,000-asset Realm case and render-cost harness now have isolated local/CI lanes, but other large-corpus bounds still rely on their ordinary suite owners. New resource-sensitive contracts need explicit concurrency and schedule decisions.
- Some visible outcomes stop at internal state. Many bridge and command tests assert projections and mocks but do not mount the consuming component. Translation, media, memory, optimistic rollback, and provider-profile changes need selective DOM/browser confirmation.

## Regression-critical test groups

Intermediate display protocol/cache/route coverage lives in
`src/ts/process/displaySourceProtocol.test.ts`,
`src/ts/server/displaySources.test.ts`,
`server/fastify/__tests__/displaySourceCache.test.ts`, and
`server/fastify/__tests__/displaySources.test.ts`. The existing ChatBody memo,
parser, scripting, Lua, trigger, bounded-regex, bootstrap, route-protection, and
generation suites remain companion parity coverage. The server route cases pin
the per-target ephemeral scriptstate contract: same-target reads see temporary
writes, sibling targets start from the authoritative baseline, and SQLite plus
the response revision remain unchanged. The route test also places the SQL
load-cost harness around cold and warm display batches, allowing only the three
required transform collections while rejecting whole-character, whole-chat,
asset, and unrelated-collection payload scans. Its metric assertions distinguish
the cold misses from warm cache hits and pin the queue/load/fingerprint timing
dimensions.
The browser bridge cases also prove that critical newest-message targets settle
before deferred background rows enter the revision lane, and that changing the
visible chat aborts an obsolete fetch before the replacement batch starts.
Cache cases cover exact-namespace reuse after a context switch, isolation
between namespace identities, least-recent namespace retirement, stale
in-flight completion rejection, and entry/byte bounds aggregated across all
retained namespaces. The route metric case exercises the same A/B/A namespace
sequence through Fastify.

1. Outbox, dispatch, replay, bootstrap, and invalidation: `pendingMutationOutbox`, `durableMutationDispatch`, `durableMutationTerminalRejection`, `pendingMutationReplay`, browser `commands`, `bootstrap`, `startupReadiness`, `resourceState`, `resourceInvalidation`, and the Phase 0/7 browser matrices. These are the core protection against lost, duplicated, or stale user edits.
2. Generation goldens and durable lifecycle: `sendChat.fixtures*`, server `assemble`, `generation.chat`, `durableGeneration`, provider transport/terminal assertions, and the reroll Playwright journey. They protect model-visible context and durable transcripts.
3. Persistence transactions, identity repair, and recovery: command/revision/idempotency/concurrency suites, migrations, lorebook and record identity normalization, backups, save/bundle codecs, asset GC, and Realm atomic staging. These defend user data at rest and through destructive operations.
4. Provider conformance, credentials, and egress: provider request/stream/catalog contracts, dispatch-option parity, stale inline-secret migration, model-profile secret tests, provider operation allowlists, OAuth refresh, SSRF, redaction, and request/body/decompression limits. Regressions here have security impact beyond functional breakage.
5. Memory jobs: repository transitions, embed/summarize handlers, worker fairness/cancellation/shutdown, selection/ranking, browser terminal fences, and prompt-memory fixtures. Partial failures otherwise risk corrupt indexes or permanently active jobs.
6. Performance gates: render/clone probes and server load-cost assertions. They are the only direct defense against accidentally restoring whole-corpus work to common actions.

## Tests requiring attention

- Structural or implementation-coupled checks: `AccessibleIconActions`, several Bot/character/module/editor accessibility gates, `browserLocalSurface`, source-text bridge assertions, clone-count probes, exact epoch/cache/read-count tests, and terminal-oracle tests. Some are useful architecture policy; they should be labeled as such and paired with behavior assertions rather than treated as user-outcome evidence.
- Very large suites: browser `commands.test.ts`, `chatCommands.test.ts`, `storage/database.svelte.test.ts`, `TranslatorPresetSettings.svelte.test.ts`, the `DefaultChatScreen*.test.ts` family, `SideChatList.svelte.test.ts`, and backend `generation.chat.test.ts`/`assemble.test.ts` combine many concerns and dense shared mocks. Their scenarios are mostly valuable, but failure diagnosis and safe fixture changes are difficult.
- Repeated race/focus matrices: latest-operation upload tests, modal focus/Escape checks, dirty-field rollback, and route allow/deny tables repeat setup across domains. Consolidate shared contracts without deleting ownership-specific cases.
- Browser failure isolation: the visible-state journeys now synchronize on command responses, applied revisions, lineage conflict, navigation, document reload, and settled DOM/store state, and attach recent console/page errors on failure. The first Fastify browser smoke remains a long, monolithic journey whose failure location can be hard to interpret.
- Conditional/resource-sensitive gates: keep the direct-only Realm scale, render, and load-cost harnesses under controlled concurrency.
- Narrow tests: several icon/DropList/supporter/static token/source-presence checks prove only one mapping or markup fact. Keep them cheap, but do not count them as substitutes for interaction or accessibility-name computation.
- Global test doubles: the Vitest baseline now installs the production clone helper, with native/fallback semantics and global-restoration behavior locked by tests. It still mocks KaTeX to an empty module; retain at least one non-mocked math-rendering integration.
- Shared browser fixture state: two Playwright specs reuse one Fastify/SQLite fixture across their serial cases. This is efficient but order-coupled. A common fixture with explicit per-test state ownership/reset would make failures easier to reproduce.
- Explicit resource composition: migrated Fastify suites use `injectComposedResourceDatabase` only when they need an assembled read-after-write view. The real bootstrap response remains unmodified and has no synthetic `database` property; new tests should prefer the narrow resource reader that owns the behavior.

## Prioritized recommendations

1. Add the remaining end-to-end reliability journeys. First: real composer submission → incremental stream → durable completion → reload. Second: stage a durable edit → lose the response/kill the page → reload and replay exactly once, with a two-tab writer-transfer variant. Third: extend the existing visible backup-restore/reload proof by staging encrypted outbox work before restore and asserting quarantine/reconciliation.
2. Strengthen CI governance. Keep the fast UI sentinel's production-only denominator and add realistic per-area or changed-file floors for high-risk frontend/backend code. Keep Playwright artifacts plus isolated Realm/performance lanes as required owners.
3. Replace remaining fixed timing and improve failure isolation. Use observable barriers in backup/abort, Lua, worker, and remaining browser/server tests; keep parameter rows behavior-oriented and uniquely named; split monolithic browser smoke while preserving its cross-layer assertions.
4. Create shared parity contracts. Generate or share typed fixtures for client/server provider capability, durable routes, SSE event vocabulary, prompt/lore parity, and preset schemas while preserving boundary-specific assertions; keep the completed persisted-asset owner catalog parity gate current.
5. Target uncovered high-risk semantics. Prioritize CBS/lore/trigger effects, similarity ranking with malformed/mixed vectors, Realm card conversion variants, plugin sandbox/safety branches, cache limits/quota failures, and provider error/content-block variants over indiscriminate global percentage increases.
6. Refactor the test architecture. Split mega-suites by behavior, centralize durable-command/race/focus harnesses, replace source-string checks with mounted behavior or one explicit static architecture gate, and retain exact state/DOM assertions in domain-owned tests.
7. Add bounded integration canaries. Use sanitized recorded upstream responses and optional live provider/media/Push canaries with strict cost, secret, timeout, and network controls. They should supplement—not make flaky—the deterministic default suite.

## Reading the detailed documents

Each feature document lists its primary inventory, groups representative cases by behavior, explains the regression protected, and evaluates assertion strength, overlap, coupling, realism, and gaps. Cross-cutting tests may appear in more than one document—for example, a memory modal in both memory and character UI. Inventories name files rather than claiming a suite-wide count; use runner discovery when an exact current count is needed.
