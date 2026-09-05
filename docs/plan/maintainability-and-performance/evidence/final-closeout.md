# Final Findings and Verification

Final verification source: `e91f2438b7464906544110df99e5a19ce507c4df` (runtime implementation through
`9650d422c`, ordinary-token encoding). Phase 5's complete transcript cost and
sixteen-case native acceptance source is `f384980479a3e0a82c7ab9b25771f6222a0275b5`.
Later changes consolidate trigger policy, preserve supported sparse custom-model
inputs, narrow legacy Lua edit owners, add Korean transcript labels and avoid
unnecessary special-token scanning. The verification records below distinguish
those anchors and the exact checks rerun after each relevant change.

All measurements use synthetic disposable fixtures and local test servers.
No production data, external providers, deployments or pinned historical
compatibility environments were involved.

## Final Finding Dispositions

All ten required remedies are implemented. None is deferred. Retained costs
below are explicit boundaries of those remedies, with their current owners;
they do not turn a failed gate into an accepted optimization.

| Finding | Final source owner and implemented result | Measured result and retained cost |
| --- | --- | --- |
| F01 | `server/fastify/src/routes/commands.ts` creation routes use targeted append in `repository.ts`; `commands/agentPresets.ts` deletes through the targeted cross-owner mutation boundary. | Existing BardWiki/settings/documents/version/search/link and unrelated rows survive creation/deletion, replay and rollback. Deletion still examines chat JSON for matches and validates loadouts; broad import/restore replacement remains intentional. |
| F02 | `repository.ts` selected preflight/assembly loaders and `routes/generationChat.ts` request-scoped resources. | Ordinary preparation excludes unrelated history, collections and assets. Five preflight rows and nine assembly rows at fixed target history; 160 target messages require 165 rows. Global settings JSON and pre-extraction embedded-character storage are named scaling exceptions. |
| F03 | `src/ts/chatCommands.ts` metadata and organization capture/restore; sidebar/compact-list callers. | Folder metadata capture stays 126 bytes regardless of unrelated histories. Structural capture retains only affected owner/removed/new data; reset necessarily retains the owner's removed chats. The broad `currentChatStateSnapshot` has no live production callers. |
| F04 | `src/ts/server/resourceCache.ts`, `resourceReads.ts`, `hydrationReads.ts`. | Validated delivery does not await optional persistence/pruning. Eight-read bursts coalesce to one prune/three enumerations. Queue, growth and retained bounds are explicit; response ownership capture, hashing, IndexedDB cloning and eventual full prune enumeration remain. |
| F05 | `src/ts/server/pendingMutationOutbox.ts` owned normalized continuation. | Mutable staged/replaced intents normalize/clone once; metadata extraction adds no body clone. Frozen JSON can reuse ownership. Envelope encryption/serialization and transport remain; persisted untrusted data is validated again on read. |
| F06 | `src/lang/index.ts`, `loadLanguagePack.ts`, startup readiness. | English is the initial fallback, only the selected non-English pack is requested. Initial closure and cold/warm locale measurements below recheck membership, size and readiness. Selected-chunk load/failure/retry remain asynchronous costs. |
| F07 | `maintenanceCoordinator.ts`, `assetReferenceScan.ts`, `backupFiles.ts`, `backupCopyPool.ts`, `backupCopyWorker.ts`, `assetGc.ts`, repository/app lifecycle. | Original API/event-loop limits pass with bounded workers/cooperative scans and freshness fences. Total backup/GC completion is slower than the synchronous baseline; oversized projections, single native copies, public listing and journaled restore remain explicit costs. |
| F08 | `src/lib/ChatScreens/transcriptResidency.ts`, `Chats.svelte`, interaction/view owners and `DefaultChatScreen.svelte`. | Full rich-text matrix passes original heap/page/scroll limits; 31 maximum ordinary measured rows, 0.015625-pixel anchor drift. Compact layout has 40 visible/46 mounted rows. Large settled viewport work still takes 1.440/1.273/3.380 seconds after rapid motion. |
| F09 | `server/fastify/src/prompt/serverTypes.ts`, `generationInputDecoder.ts`, checked-in generated validators and typed effective settings. | Finite checked domain views preserve supported sparse/legacy inputs and immutable ownership. Runtime validator compilation is eliminated; module parse/validation and deliberately dynamic script work remain. |
| F10 | `packages/shared-core/src/triggerCompatibility.ts`, narrow package export and two forwarding facades. | One unchanged 41-effect catalog, exact regex classifier and cycle-safe diagnostic traversal; both live runtime consumers share implementation. Actual execution/no-op enforcement remains Fastify-owned. |

Source review checked all ten findings and their live call sites. Four independent
read-only Luna areas covered accepted browser, server, maintenance and UI owners;
root reconciled their references against source. Historical status entries and
opening source inventories remain chronological. In particular,
`applyMessageFreeJsonCommandMutation` now has only its declaration in production;
the opening Agent Preset deletion caller was removed by the accepted follow-up.
The old broad `loadPersistedForAssembly` remains a display-source fallback;
ordinary prompt generation uses `loadPersistedForGenerationAssembly`.

## Bounds, Residual Owners and Revisit Conditions

- Targeted Agent Preset cleanup still searches authoritative chat JSON and
  validates affected loadouts; import/restore can intentionally replace the
  database. The command/repository owners retain these costs to preserve atomic
  selection cleanup and recovery. Revisit on measured deletion latency scaling,
  unexpected physical table writes or any BardWiki preservation failure; retain
  the one-revision/event, replay and rollback assertions.
- Scoped rollback retains only required affected/new/deleted data. Revisit the
  command capture owner if an unrelated-history cost gate regresses or a new
  operation requires additional authoritative rollback fields. Keep newer-draft,
  selection, projection-epoch and writer fences.
- Cache admission is 64 jobs / 32 MiB / 8,192 value references / 1,024 manifests,
  with 2,048-code-unit keys and a fixed 50 ms coalescing timer. Retained limits
  are 64 MiB / 32,768 entries / 512 manifests; temporary normal growth is at most
  96 MiB / 40,960 entries / 1,536 manifests before convergence. Revisit the cache
  owner on a bound/progress regression or measured pruning pressure; preserve
  authentication/lineage/generation fencing and disposable ownership.
- Outbox input limits remain 100 requests, 32 dependency keys and 16 MiB payload.
  Revisit normalization only if staged-body clone/count gates regress; durable
  encrypted-envelope construction and validation of restored data remain required.
- Locale loading retains English plus the requested pack because the first
  composer must render the selected language. The language/startup owners retain
  asynchronous chunk loading and retry. Revisit if an unused pack enters the
  initial graph, the 194,860-byte gzip limit fails, or first-label readiness and
  failed-chunk retry regress in the cold/warm browser journeys.
- Generation query programs use a per-database WeakMap, at most sixteen programs;
  selectors above 4,096 binding bytes bypass retention. No query result cache is
  introduced. Revisit selected readers/settings storage if original preparation
  budgets regress or a collection moves out of the global settings row. Remove
  the named legacy exception only when pre-extraction support is retired. Target
  history and dynamic module/script access remain required work; existing trigger
  execution limits are 100,000 effect steps, 10,000 loop-back edges and depth ten.
  Lua retains thirty requests/window, 2,000,000-byte responses and 6,000 ms total
  sleep. These are execution bounds, not a claim of constant prompt latency.
- The decoder owns five checked domain roots and 447 generated schema
  definitions. Module parsing and input validation remain necessary at unknown
  persisted-input boundaries; runtime validator compilation remains zero.
  Revisit if finite views become aggregate escape hatches, supported legacy
  fixtures reject, or validation breaks the original preparation limits.
  The token adapter owner must revisit the ordinary-text guard if the installed
  special-token manifest invariant or exact token/error parity changes.
- Maintenance admits one exclusive operation and one GC sweep with no waiting
  queue. Scanner pages contain at most 64 rows; slices yield after 256 KiB or
  4 ms with a 2 MiB scratch cache. Backup has two workers, one sixteen-descriptor
  batch and a 64 KiB hash buffer each; directory buffering is at most 64×32
  entries. GC has four in-flight grace stats, sixteen deletions/transaction and
  1,024 retained diagnostic IDs plus full counts. See [maintenance residuals](maintenance-scheduling.md#retained-costs-and-recovery)
  for measured single-row/file limits and listing/restore/stale-sweep revisit
  triggers; uncancellable native work always drains before ownership release.
- Transcript starts at thirty working rows, grows by fifteen to sixty for dense
  layouts, and keeps the hard ceiling of 76 after subtracting pins. Eight
  distinct long-lived interaction rows and up to ten singleton IDs share that
  ceiling. Height and view caches each retain at most 2,048 entries. Hydration
  remains separate; screenshot capture temporarily materializes full DOM and
  restores it in cleanup. Browser find/cross-message drag limits are the user's
  accepted product decision. Revisit on row/coverage/anchor-budget failure,
  lost interaction state or a supported workflow needing unmounted DOM.
- Shared trigger diagnostics use a per-call visited-object set proportional to
  the supplied definition graph; no persistent cache or new execution authority
  is introduced. Revisit classification when supported server execution changes,
  updating the shared catalog and consumer behavior tests together.

Current contracts and downstream navigation are in [data/events](../../../structure/data-and-events.md),
[mutation recovery](../../../structure/durable-mutations-and-recovery.md),
[resources/cache](../../../structure/server-resources-and-bridges.md),
[prompt/scripting](../../../structure/prompt-assembly-and-scripting.md),
[assets/saves](../../../structure/assets-and-saves.md),
[backend](../../../structure/backend.md), [chat UI](../../../../src/docs/svelte-chat-ui.md),
[navigation UI](../../../../src/docs/svelte-navigation-ui.md),
[locale UI](../../../../src/docs/svelte-ui.md#localization), and
[shared-core](../../../../packages/shared-core/README.md).

## Final Measured Costs

| Area | Accepted final measurement | Original comparison / scope |
| --- | --- | --- |
| Generation, small | Preflight 0.366937 ms; assembly 1.366220 ms | Limits 0.453 / 2.409 ms; nine samples from three fresh processes, one warmup and three measured repetitions each. |
| Generation, unrelated corpus 48 | Preflight 0.233674 ms; assembly 0.902917 ms | Limits 1.066 / 2.812 ms; same selected four-message fixture, with 144 unrelated chats / 1,152 history rows / 384 assets. |
| Generation, required 160-message history | Preflight 0.264514 ms; assembly 4.231988 ms | Required target history is intentionally proportional work; 165 returned rows and no unrelated corpus clones. |
| Generation, configuration / legacy exceptions | 48 unused configuration records: 0.549986 / 1.051361 ms; 48 embedded legacy characters: 2.716065 / 3.499405 ms | Global settings parsing and pre-extraction compatibility remain explicit exceptions; the legacy result exceeds ordinary limits and is not described as constant-cost. |
| Initial JavaScript | 159,566 gzip bytes; immediate closure 1,163,265 gzip bytes | Opening 389,721 / 1,377,316 bytes; original initial limit 194,860 bytes. Only English is statically included. |
| Large backup | Event-loop gap / concurrent API median 5.070232 / 3.805376 ms | Original limits 7.924 / 8.142 ms; nine-sample 20/200/2,000-asset matrix at `e9af657a5`. |
| Large asset GC | Event-loop gap / concurrent API median 4.997915 / 5.234135 ms | Original limits 16.117 / 16.576 ms; API and heartbeat progress while unfinished, reference protection and cleanup assertions pass. |
| Large transcript, desktop / mobile / CPU4x | Scroll p95 18.6 / 18.6 / 25.1 ms; retained heap 23.818 / 22.622 / 22.655 MiB | Original scroll limits 33.8 / 33.8 / 35.2 ms and heap limits 71.180 / 64.864 / 64.873 MiB pass; 600 hydrated messages, bounded mounted residency. |
| Large transcript page layout/style | 25.219 / 22.148 / 110.792 ms | Original limits 52.876 / 49.112 / 257.032 ms; settlement separately waits for readable source-correct viewport content before GC. |

[Final generation evidence](closeout-generation-final.json) contains every
structural observation and all 216 measured timing values across twelve axes.
The [first closeout](closeout-costs-first.json), [refreshed miss](closeout-costs-second.json)
and [alternating accepted/current control](closeout-generation-paired.json) remain
intact. Both alternating sources missed the small assembly limit; repeated later
identical fixtures were faster. An [opt-in diagnostic CPU profile](closeout-generation-profile.json)
identified encoding as the largest sampled owner. Its setup/sample overhead is
explicit and none of its timings count toward acceptance.

`tokens.ts` now calls the ordinary cl100k/o200k encoder only when `<|` cannot
occur. Every installed special token starts with that prefix; the standard
encoder and exact rejection behavior remain for text containing it. This is
verified against installed encoders for exact IDs/counts, Unicode, malformed
surrogates, incomplete prefixes and all seven special tokens. No token results
are cached, final retokenization remains independent, and no original fixture,
warmup, repetition or budget changes. Focused tokenizer 25, golden counts 12,
assembly 142 and final-budget 10 tests pass.

[Refreshed deterministic/cache/locale/maintenance evidence](closeout-costs-second.json)
retains every prior dimension and production chunk membership; only its small
generation assessment is superseded by the final generation record. None of
those browser/maintenance owners changed in the subsequent token adapter fix.
[Transcript costs](transcript-after.json) retain all 234 stages, eighteen
48-frame scroll sweeps and eighteen settlement observations. [Final native
transcript evidence](transcript-final-native.json) contains all sixteen cases.
The later type-only compact observation and locale additions also pass twelve
native transcript and three locale runtime cases.

## Combined Verification and Limitations

At `e91f2438b`, [the final aggregate and native command ledger](closeout-final-verification.json)
record a passing `pnpm test:agent` in 143.904 seconds. All seven lanes pass:
protocol/shared/Fastify/browser types; topology/inventories; current docs;
680 frontend files / 8,207 tests; frontend check (zero errors/warnings);
219 server files / 4,000 tests; and the browser-smoke build. Five existing
skips remain, for 12,207 passed tests in total.

After the final encoder change, the exact
`RISU_BROWSER_SMOKE_WORKERS=1 pnpm test -- server/fastify/browser-smoke/acceptedSendProtocol.spec.ts`
invocation passes all eleven native cases (23.2 seconds in Playwright; 37.276
seconds including the focused runner/build). Coverage includes response loss,
reload/mobile visibility, exact retry, process restart, Stop, observer expiry,
two-chat isolation and queued finalization.

The prior complete recovery/startup selection at `e9af657a5` passes 26 native
cases across six exact files, representing 37 journeys. The files are
`startupRecoveryIntegrationMatrix.spec.ts` (7), `visibleStateRecovery.spec.ts`
(3), `startupCachePopulationMatrix.spec.ts` (1), `acceptedSendProtocol.spec.ts`
(11), `selectedLocaleRuntime.spec.ts` (3), and `selectedLocaleStartup.spec.ts`
(one case with twelve cold/warm journeys), all under the browser-smoke directory.
That source also passes metadata (3), organization (25 plus three baseline
skips), outbox (6), cache (3) and server-load (38) deterministic work tests.
Their runtime owners remain unchanged in the final token adapter correction.

The first three failed aggregates remain recorded separately:
[first](closeout-first-verification.json), [second](closeout-second-verification.json),
[third](closeout-third-verification.json). Repairs preserve supported inputs and
assertions; reviewed maintained inventory counts follow actual live source and
test references. The [fourth aggregate and full command ledger](closeout-fourth-verification.json)
passed at `e9af657a5` while the refreshed timing miss remained open. That pass did
not waive the performance gate. The final encoder correction closes it with
separate unprofiled measurements and a subsequent aggregate.

`pnpm test:agent` covers core types, current documentation, topology/inventories,
frontend/server unit suites and the browser-smoke build. It does not run native
Playwright journeys or specialized performance probes; those commands and
anchors are listed separately in the evidence. `pnpm test:all`, full quality,
coverage/scale, current-stack compatibility and pinned historical differential
lanes remain user/CI-owned and were not run for this closeout.

Documentation closeout validates the 49 current documents plus every Markdown
file in this workstream explicitly with `validateCurrentDocumentation`, no
index specs or path exemptions. Archival preserves the plan, phases, status and
all earlier failed/accepted evidence; moved links and the archive/active indexes
are repaired and revalidated.
