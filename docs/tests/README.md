# Test Suite Audit

Audit snapshot: **2026-07-17**. This documentation groups the suite by protected product behavior. File counts are unique within each runner; parameterized counts are runtime-expanded where the runner exposes them.

## Executive summary

The suite is large, healthy, and unusually strong at the application's highest-risk state and protocol boundaries. The audit accounts for **543 test files and 7,435 collected cases**: 4,854 frontend/gate Vitest cases, 2,575 backend Vitest cases, and 6 Playwright cases. A clean audit run produced **7,434 passes and one normal-lane skip**. The skipped Realm 7,000-asset stress case passed in a direct-file run, so there was no known reproducible product failure at the end of the audit.

The strongest coverage protects durable writes, revisions, optimistic rollback, prompt assembly, provider wire contracts, streaming terminal behavior, bounded imports, backups, memory jobs, stale asynchronous UI work, and accessibility/focus behavior. Assertions are commonly exact and stateful: request bodies and headers, SSE frame order, SQLite rows and revisions, IndexedDB outbox contents, rollback scope, visible DOM state, and resource cleanup are all checked.

The main weakness is integration depth rather than raw case count. Most frontend tests run in happy-dom with mocked network/storage/browser APIs; most provider tests mock upstream services; and only six Playwright cases cross the built browser/Fastify/SQLite boundary. There is no normal composer-to-stream-to-durable-reload browser journey, no real crash/reload or two-tab outbox journey, and no destructive backup-restore/outbox-quarantine journey. CI also enforces only a deliberately small UI coverage sentinel, not the much broader frontend or backend coverage maps.

## Index

### Product flows and UI

- [App Navigation and Chat](app-navigation-and-chat.md) — routing, chat rendering/composition, lists, rerolls, responsive navigation, and browser smoke.
- [Settings, Profiles, and Extensions](settings-profiles-and-extensions.md) — settings pages, model/profile editors, modules/plugins, translators, personas, and Agent Preset UI.
- [Character Content, Memory, and Catalogs](character-content-memory-and-catalogs.md) — character editors, lore/scripts, Hypa controls, Realm/catalog and mobile character behavior.
- [Shared UI, Feedback, and Accessibility](shared-ui-feedback-and-accessibility.md) — alerts, dialogs, generic controls, focus, onboarding, feedback, and platform surface gates.
- [Playground and Specialized Tools](playground-and-specialized-tools.md) — Playground execution, conversion, media, parser, translation, MCP, and developer tools.

### State, data, and platform

- [Browser State Sync and Recovery](browser-state-sync-and-recovery.md) — bootstrap, writer identity, encrypted outbox, replay, hydration, invalidation, refresh, and stale-state fences.
- [Domain Mutations and Editing Bridges](domain-mutations-and-editing-bridges.md) — optimistic character/chat/settings/preset/persona/loadout/module/lorebook/script edits and rollback.
- [Persistence, Revisioned Commands, and Events](persistence-commands-and-events.md) — SQLite repositories, migrations, revisions, receipts, command transactions, events, projections, and resource reads.
- [API Security, Runtime, and Network Boundaries](api-security-and-runtime.md) — auth, body limits, SSRF/egress policy, tracing/redaction, Web Push, startup/shutdown, and operational routes.
- [Assets, Import/Export, and Backups](assets-import-export-and-backups.md) — assets, garbage collection, save codecs, backup/restore, bundles, Realm/CharX, browser uploads, and compatibility adapters.

### AI behavior and extensibility

- [Prompting, Generation, and Streaming](prompting-generation-and-streaming.md) — prompt construction, preflight, generation, SSE, durability, reroll, Agent Presets, and cost gates.
- [Providers, Models, and Media](providers-models-and-media.md) — model profiles, capability/routing, provider adapters, credentials, translation, image/audio/transcription, and codecs.
- [Memory and Embeddings](memory-and-embeddings.md) — Hypa planning, summaries, embeddings, ranking, job execution, worker/API/browser reconciliation, and memory UI.
- [Scripting, Parsing, and Automation](scripting-parsing-and-automation.md) — CBS, regex scripts, triggers, Lua, HTML/chat parsing, templates, and bounded execution.
- [Plugins, Modules, and MCP](plugins-modules-and-mcp.md) — plugin permissions/sandboxing, module lifecycle, MCP transports/OAuth/tools, and RisuAccess resources.

## Audit execution and coverage

| Runner/lane                              |               Files | Collected cases | Audit result                         | What it proves                                                   |
| ---------------------------------------- | ------------------: | --------------: | ------------------------------------ | ---------------------------------------------------------------- |
| Frontend Vitest including explicit gates |                 415 |           4,854 | 4,854 passed                         | happy-dom component/state tests plus audit and performance gates |
| Backend Vitest                           |                 125 |           2,575 | 2,574 passed, 1 skipped              | Node/Fastify/SQLite/repository/provider route behavior           |
| Direct Realm stress run                  | 1 (already counted) |              26 | 26 passed                            | Includes the normally skipped 7,000-display-asset case           |
| Playwright Chromium smoke                |                   3 |               6 | 6 passed                             | Built SPA + in-process Fastify + SQLite browser journeys         |
| **Unique total**                         |             **543** |       **7,435** | **7,434 passed, 1 conditional skip** | The complete discovered suite                                    |

The clean broad coverage runs reported:

| Map                                               |  Lines | Statements | Functions | Branches | Enforcement                          |
| ------------------------------------------------- | -----: | ---------: | --------: | -------: | ------------------------------------ |
| Frontend (`src/**/*.{ts,svelte}`, `util/**/*.ts`) | 65.91% |     62.49% |    58.73% |   56.38% | Report only; no repository threshold |
| Backend (`server/fastify/src/**/*.ts`)            | 86.04% |     83.72% |    91.81% |   72.93% | Report only; no repository threshold |
| CI UI map (6 files / 121 repeated cases)          | 10.02% |      8.91% |     6.92% |    6.39% | Enforced minima: 8% / 7% / 5% / 4%   |

`pnpm test:all`, used by the quality workflow, runs format checking, the root Svelte/browser type check, client-library declaration emission and strict Fastify/Playwright-source TypeScript projects through `pnpm check:server`, ordinary frontend tests, the four explicit gate files, the six-file/121-case UI coverage map, backend tests, and Playwright smoke. The UI-map cases already appear in the ordinary frontend lane and are repeated to collect focused coverage: CI encounters 7,556 definitions, versus 7,435 unique cases. Both Vitest configs always disable focused tests; Playwright sets `forbidOnly` in CI. The runners use no retries, and Playwright is serial. The broad `pnpm coverage:frontend` and `pnpm coverage:backend` maps are available but are not part of that CI command. CI does not upload retained Playwright traces/test results. The UI threshold is aggregate rather than per-file. Coverage figures are directional: declarations, compatibility paths, generated/static data, entrypoints, test harness/stub sources, and unmounted Svelte branches make global percentages less informative than the high-risk seams called out below.

## Major coverage strengths

- **Durable state and data integrity.** The revision/receipt transaction suites, encrypted pending-mutation outbox, replay/dependency lanes, hydration fences, targeted invalidation, and field-scoped rollback tests are the suite's deepest protection. They exercise response loss, stale writers, concurrent edits, partial success, restart recovery, and real SQLite constraints.
- **Prompt and generation contracts.** Exact prompt rows, golden local/server-backed fixtures, eligibility matrices, terminal SSE vocabulary, fragmented frames, disconnect/reattach/cancel behavior, and reroll persistence make semantic or message-loss regressions likely to be caught.
- **Provider and security boundaries.** Every major provider family has request/stream/error/abort coverage. Secret masking, stable identity, fixed-operation allowlists, endpoint binding, SSRF prevention, body/decompression caps, trace redaction, and prototype-pollution cases are especially valuable.
- **Recoverability and untrusted content.** Backups, `.risu` codecs, bundle import/export, asset hashing/GC, Realm/CharX staging, rollback, size caps, aborts, and historical-format normalization use real files, archives, bytes, and SQLite state rather than only shape mocks.
- **Asynchronous UI ownership.** Character, media, catalog, modal, settings, memory, translation, and Playground tests consistently guard "latest request wins," target disappearance, stale completion, dirty-field preservation, cancellation, and focus restoration.
- **Performance invariants.** Clone counts, SQL reads/table writes, cache reuse, parser invalidation, asset loads, and large-corpus request shapes explicitly protect users with large libraries. These assertions are implementation-aware but cover real regression classes.

## Major gaps

- **Too few complete browser journeys.** Six serial Chromium cases cannot cover the number of independently tested layers. Missing high-value journeys include normal composer streaming and reload, crash/replay, two-tab writer transfer, profile creation-to-generation, Hypa jobs, multi-step loadouts/modules, and destructive backup restore with queued outbox work.
- **Mocked external and browser behavior.** Provider APIs, Web Push, Web Speech/AudioContext, image decoding/canvas/compression, workers, IndexedDB quota/upgrade failure, Web Locks, and most service-worker behavior are simulated. Deterministic unit tests should remain, but bounded opt-in canaries and a few real-browser media/storage cases are needed.
- **Coverage and CI governance are narrow.** The enforced UI map samples six files and barely clears low aggregate thresholds; the much broader frontend/backend maps have no floors or changed-file policy. CI does not publish retained Playwright traces and test results. Important low-covered seams include browser Hypa implementations, plugin safety/sandbox branches, parsing/script orchestration, some provider adapters, backend CBS/lorebook/trigger effects, Realm card conversion, and several runtime/error branches.
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
- **Conditional/resource-sensitive gates:** schedule the direct-only Realm stress case, and run render/load-cost harnesses with controlled concurrency. One overloaded audit attempt produced an opaque render-harness failure; the case passed alone and in the clean all-frontend coverage rerun.
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

Each feature document lists its primary inventory, groups individual and parameterized cases by behavior, explains the regression protected, and evaluates assertion strength, overlap, coupling, realism, and gaps. Cross-cutting tests may appear in more than one document—for example, a memory modal in both memory and character UI—but each inventory states its primary accounting boundary so overlap is not mistaken for additional tests.
