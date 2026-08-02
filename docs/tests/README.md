# Test Suite Guide

Last audited: 2026-08-02.

This documentation groups the current suite by protected product behavior. Treat `package.json` and the runner configuration files as the source of truth for commands and discovery; this guide intentionally avoids snapshot case counts and pass totals, which become stale whenever tests are added or parameterized matrices change.

## Executive summary

The suite is strongest at the application's highest-risk state and protocol boundaries: durable writes, revisions, optimistic rollback, prompt assembly, provider wire contracts, streaming terminal behavior, bounded imports, backups, memory jobs, stale asynchronous UI work, and accessibility/focus behavior.

Assertions are commonly exact and stateful: request bodies and headers, SSE frame order, SQLite rows and revisions, IndexedDB outbox contents, rollback scope, visible DOM state, and resource cleanup are all checked.

The main weakness is integration depth rather than raw case count. Most frontend tests run in happy-dom with mocked network/storage/browser APIs; most provider tests mock upstream services; and the small serial Playwright suite covers only selected built-browser/Fastify/SQLite journeys. There is no normal composer-to-stream-to-durable-reload browser journey, no real crash/reload or two-tab outbox journey, and no destructive backup-restore/outbox-quarantine journey. CI also enforces only a deliberately small UI coverage sentinel, not the much broader frontend or backend coverage maps.

## Index

### Product flows and UI

- [App Navigation and Chat](app-navigation-and-chat.md) — routing, Mood Light route/selection guards, floating composition, chat lists/reset, rerolls, responsive navigation, and browser smoke.
- [Settings, Profiles, and Extensions](settings-profiles-and-extensions.md) — settings pages, model/profile editors, modules/plugins, translators, personas, and Agent Preset UI.
- [Character Content, Memory, and Catalogs](character-content-memory-and-catalogs.md) — character editors, Mood Light membership, lore/scripts, Hypa controls, Realm/catalog and mobile character behavior.
- [Shared UI, Feedback, and Accessibility](shared-ui-feedback-and-accessibility.md) — alerts, drag-safe backdrop dismissal, dialogs, generic controls, focus, onboarding, feedback, and platform surface gates.
- [Playground and Specialized Tools](playground-and-specialized-tools.md) — Playground execution, conversion, media, parser, translation, MCP, and developer tools.

### State, data, and platform

- [Browser State Sync and Recovery](browser-state-sync-and-recovery.md) — bootstrap, writer identity, encrypted outbox, replay, hydration, invalidation, refresh, and stale-state fences.
- [Domain Mutations and Editing Bridges](domain-mutations-and-editing-bridges.md) — optimistic character/chat/settings/preset/persona/loadout/module/lorebook/script edits and rollback.
- [Persistence, Revisioned Commands, and Events](persistence-commands-and-events.md) — SQLite repositories, migrations, revisions, receipts, command transactions, events, projections, and resource reads.
- [API Security, Runtime, and Network Boundaries](api-security-and-runtime.md) — auth, body limits, SSRF/egress policy, tracing/redaction, Web Push, startup/shutdown, and operational routes.
- [Assets, Import/Export, and Backups](assets-import-export-and-backups.md) — assets, garbage collection, save codecs, backup/restore, bundles, bounded high-cardinality Realm/CharX imports, browser uploads, and compatibility adapters.

### AI behavior and extensibility

- [Prompting, Generation, and Streaming](prompting-generation-and-streaming.md) — prompt construction, CBS history/index semantics, preflight, generation, SSE, durability, reroll, Agent Presets, and cost gates.
- [Providers, Models, and Media](providers-models-and-media.md) — model profiles, Strip CoT, Neuralwatt and other provider adapters, credentials, translation, image/audio/transcription, and codecs.
- [Memory and Embeddings](memory-and-embeddings.md) — Hypa planning, summaries, embeddings, ranking, job execution, worker/API/browser reconciliation, and memory UI.
- [Scripting, Parsing, and Automation](scripting-parsing-and-automation.md) — CBS, regex scripts, triggers, Lua, HTML/chat parsing, templates, and bounded execution.
- [Plugins, Modules, and MCP](plugins-modules-and-mcp.md) — plugin permissions/sandboxing, module lifecycle, MCP transports/OAuth/tools, and RisuAccess resources.

## Running the suite

| Command                  | Scope                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `pnpm test`              | Alias for the ordinary frontend Vitest lane                                                                   |
| `pnpm test:frontend`     | Frontend happy-dom tests; excludes `src/ts/__tests__` and `src/lib/_audit`                                    |
| `pnpm test:frontend:all` | Frontend tests including both explicit gate directories                                                       |
| `pnpm test:gates`        | All explicit performance and audit gates                                                                      |
| `pnpm test:gates:perf`   | The two named render/clone performance probes                                                                 |
| `pnpm test:gates:audit`  | The two mounted visible-state audit gates under `src/lib/_audit`                                             |
| `pnpm test:server`       | Node/Fastify/SQLite tests discovered by `server/fastify/vitest.config.ts`                                     |
| `pnpm test:smoke`        | Serial Chromium tests under `server/fastify/browser-smoke`                                                    |
| `pnpm test:all`          | The quality-workflow aggregate: formatting, both type checks, frontend, gates, UI map, server, and smoke      |
| `pnpm coverage:frontend` | Broad frontend report, including gates; not part of `test:all`                                                |
| `pnpm coverage:backend`  | Broad Fastify report; not part of `test:all`                                                                  |
| `pnpm coverage:ui-map`   | Six-file repeated UI sentinel with aggregate line/statement/function/branch floors of 8%/7%/5%/4% respectively |

Both Vitest configurations reject focused tests. Playwright is serial, retains traces on failure, and sets `forbidOnly` in CI. The normally skipped 7,000-display-asset Realm stress case is enabled by running `realmImport.test.ts` directly. Broad frontend and backend coverage are report-only; only the focused UI map has thresholds.

## Major coverage strengths

- **Durable state and data integrity.** The revision/receipt transaction suites, encrypted pending-mutation outbox, replay/dependency lanes, hydration fences, targeted invalidation, and field-scoped rollback tests are the suite's deepest protection. They exercise response loss, stale writers, concurrent edits, partial success, restart recovery, and real SQLite constraints.
- **Prompt and generation contracts.** Exact prompt rows, golden local/server-backed fixtures, eligibility matrices, terminal SSE vocabulary, fragmented frames, disconnect/reattach/cancel behavior, and reroll persistence make semantic or message-loss regressions likely to be caught.
- **Provider and security boundaries.** Every major provider family has request/stream/error/abort coverage. Secret masking, stable identity, fixed-operation allowlists, endpoint binding, SSRF prevention, body/decompression caps, trace redaction, and prototype-pollution cases are especially valuable.
- **Recoverability and untrusted content.** Backups, `.risu` codecs, bundle import/export, asset hashing/GC, Realm/CharX staging, rollback, size caps, aborts, and historical-format normalization use real files, archives, bytes, and SQLite state rather than only shape mocks.
- **Asynchronous UI ownership.** Character, media, catalog, modal, settings, memory, translation, and Playground tests consistently guard "latest request wins," target disappearance, stale completion, dirty-field preservation, cancellation, and focus restoration.
- **Performance invariants.** Clone counts, SQL reads/table writes, cache reuse, parser invalidation, asset loads, and large-corpus request shapes explicitly protect users with large libraries. These assertions are implementation-aware but cover real regression classes.

## Major gaps

- **Too few complete browser journeys.** The serial Chromium suite cannot cover the number of independently tested layers. Missing high-value journeys include normal composer streaming and reload, crash/replay, two-tab writer transfer, profile creation-to-generation, Hypa jobs, multi-step loadouts/modules, and destructive backup restore with queued outbox work.
- **Mocked external and browser behavior.** Provider APIs, Web Push, Web Speech/AudioContext, image decoding/canvas/compression, workers, IndexedDB quota/upgrade failure, Web Locks, and most service-worker behavior are simulated. Deterministic unit tests should remain, but bounded opt-in canaries and a few real-browser media/storage cases are needed.
- **Coverage and CI governance are narrow.** The enforced UI map samples six files with low aggregate thresholds; the much broader frontend/backend maps have no floors or changed-file policy. CI does not publish retained Playwright traces and test results. Important low-covered seams include browser Hypa implementations, plugin safety/sandbox branches, parsing/script orchestration, some provider adapters, backend CBS/lorebook/trigger effects, Realm card conversion, and several runtime/error branches.
- **Duplicated client/server contracts can drift.** Capability eligibility, command routes, SSE event names, prompt/lore behavior, preset schemas, asset-owner catalogs, and provider option matrices are hand-maintained on both sides. Independent tests provide defense in depth, but shared typed fixtures or parity checks are missing.
- **Scale/stress is not consistently gated.** The 7,000-asset Realm case is skipped in ordinary CI, and the render-cost harness showed resource sensitivity when the audit initially ran it concurrently with other collectors. Large-corpus bounds deserve isolated, named scale/performance lanes.
- **Some visible outcomes stop at internal state.** Many bridge and command tests assert projections and mocks but do not mount the consuming component. Translation, media, memory, optimistic rollback, and provider-profile changes need selective DOM/browser confirmation.

## Regression-critical test groups

1. **Outbox, dispatch, replay, bootstrap, and invalidation:** `pendingMutationOutbox`, `durableMutationDispatch`, `durableMutationTerminalRejection`, `pendingMutationReplay`, browser `commands`, `bootstrap`, `resourceState`, and `resourceInvalidation`. These are the core protection against lost, duplicated, or stale user edits.
2. **Generation goldens and durable lifecycle:** `sendChat.fixtures*`, server `assemble`, `generation.chat`, `durableGeneration`, provider transport/terminal assertions, and the reroll Playwright journey. They protect model-visible context and durable transcripts.
3. **Persistence transactions and recovery:** command/revision/idempotency/concurrency suites, migrations, backups, save/bundle codecs, asset GC, and Realm atomic staging. These defend user data at rest and through destructive operations.
4. **Credentials and egress:** model-profile secret tests, provider operation allowlists, OAuth refresh, SSRF, redaction, and request/body/decompression limits. Regressions here have security impact beyond functional breakage.
5. **Memory jobs:** repository transitions, embed/summarize handlers, worker fairness/cancellation/shutdown, selection/ranking, browser terminal fences, and prompt-memory fixtures. Partial failures otherwise risk corrupt indexes or permanently active jobs.
6. **Performance gates:** render/clone probes and server load-cost assertions. They are the only direct defense against accidentally restoring whole-corpus work to common actions.

## Tests requiring attention

- **Structural or implementation-coupled checks:** `AccessibleIconActions`, several Bot/character/module/editor accessibility gates, `browserLocalSurface`, source-text bridge assertions, clone-count probes, exact epoch/cache/read-count tests, and terminal-oracle tests. Some are useful architecture policy; they should be labeled as such and paired with behavior assertions rather than treated as user-outcome evidence.
- **Very large suites:** browser `commands.test.ts`, `chatCommands.test.ts`, `storage/database.svelte.test.ts`, `TranslatorPresetSettings.svelte.test.ts`, the `DefaultChatScreen*.test.ts` family, `SideChatList.svelte.test.ts`, and backend `generation.chat.test.ts`/`assemble.test.ts` combine many concerns and dense shared mocks. Their scenarios are mostly valuable, but failure diagnosis and safe fixture changes are difficult.
- **Repeated race/focus matrices:** latest-operation upload tests, modal focus/Escape checks, dirty-field rollback, and route allow/deny tables repeat setup across domains. Consolidate shared contracts without deleting ownership-specific cases.
- **Browser failure isolation:** the visible-state journeys now synchronize on command responses, applied revisions, lineage conflict, navigation, document reload, and settled DOM/store state, and attach recent console/page errors on failure. The first Fastify browser smoke remains a long, monolithic journey whose failure location can be hard to interpret.
- **Conditional/resource-sensitive gates:** schedule the direct-only Realm stress case, and run render/load-cost harnesses with controlled concurrency.
- **Narrow tests:** several icon/DropList/supporter/static token/source-presence checks prove only one mapping or markup fact. Keep them cheap, but do not count them as substitutes for interaction or accessibility-name computation.
- **Global test doubles:** the Vitest baseline now installs the production clone helper, with native/fallback semantics and global-restoration behavior locked by tests. It still mocks KaTeX to an empty module; retain at least one non-mocked math-rendering integration.
- **Shared browser fixture state:** two Playwright specs reuse one Fastify/SQLite fixture across their serial cases. This is efficient but order-coupled. A common fixture with explicit per-test state ownership/reset would make failures easier to reproduce.
- **Migration helper drift:** the shared `resourceDatabase` helper synthesizes a legacy database from current resource reads. It helps old tests migrate but can let them rely on a wire shape production no longer serves; move remaining consumers to explicit resources and retire it.

## Prioritized recommendations

1. **Add three end-to-end reliability journeys.** First: real composer submission → incremental stream → durable completion → reload. Second: stage a durable edit → lose the response/kill the page → reload and replay exactly once, with a two-tab writer-transfer variant. Third: destructive backup restore while encrypted outbox work exists → quarantine/reconcile → verify visible selection and data after reload.
2. **Strengthen CI governance.** Keep the fast UI sentinel, but exclude test-only harnesses from its production denominator and add realistic per-area or changed-file floors for high-risk frontend/backend code. Upload retained Playwright traces/test results, and put Realm scale and performance-cost suites in explicit isolated lanes, scheduled if too slow for every PR.
3. **Replace remaining fixed timing and improve failure isolation.** Use observable barriers in backup/abort, Lua, worker, and remaining browser/server tests; keep parameter rows behavior-oriented and uniquely named; split monolithic browser smoke while preserving its cross-layer assertions.
4. **Create shared parity contracts.** Generate or share typed fixtures for client/server provider capability, durable routes, SSE event vocabulary, prompt/lore parity, preset schemas, and persisted asset owners while preserving boundary-specific assertions.
5. **Target uncovered high-risk semantics.** Prioritize CBS/lore/trigger effects, similarity ranking with malformed/mixed vectors, Realm card conversion variants, plugin sandbox/safety branches, cache limits/quota failures, and provider error/content-block variants over indiscriminate global percentage increases.
6. **Refactor the test architecture.** Split mega-suites by behavior, centralize durable-command/race/focus harnesses, replace source-string checks with mounted behavior or one explicit static architecture gate, and retain exact state/DOM assertions in domain-owned tests.
7. **Add bounded integration canaries.** Use sanitized recorded upstream responses and optional live provider/media/Push canaries with strict cost, secret, timeout, and network controls. They should supplement—not make flaky—the deterministic default suite.

## Reading the detailed documents

Each feature document lists its primary inventory, groups representative cases by behavior, explains the regression protected, and evaluates assertion strength, overlap, coupling, realism, and gaps. Cross-cutting tests may appear in more than one document—for example, a memory modal in both memory and character UI. Inventories name files rather than claiming a suite-wide count; use runner discovery when an exact current count is needed.
