# Original RisuAI Behavioral Compatibility Latest Verification

Date: 2026-08-30

## Current Verdict

Phases 0 through 13 are complete. Phase 2 state/recovery implementation
closes through `3ce85c1f034b3afc493e291f8a8f5e9227064463` and the partial-object projection
correction `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`. Phase 3 closed-world durable
ownership is at `958f8585138ec817fe5d134563df585434ed5821`, with exact BardWiki eventless
receipt handling at `3f20a80b780f2538fd1e38aa6514d9a9f894985a`. Phase 5 closes settings and
authoring ownership at `b34b7a78f28cb5903ece3880073fbb9e46392cb8`, with visible character reload
evidence at `5eca30f4872e865efee2c86f4dde7ae71e915f9a`. Focused production, structural,
browser, register, and pinned differential evidence pass. Phase 4 closes its
visible route/control and responsive-shell contract through
`6487cba00e3cc435a3c4f57f8121663bcdccc57e`. Phase 6 closes prompt and durable
generation ownership through `19ba37af26df7db60d7393976d61b520a785076b`,
with exact visible failure/Retry evidence at
`477a3aece1fffc159b0354fef5b21ecddf60cab5`. This is not yet a whole-product
compatibility verdict; Phase 7 closes its provider and media matrices at
`fe7825f3da4bdd2aceb090fc6eaaa9b2cf5a6050`. Phase 8 closes memory/worker
ownership at `a77f47c9f79b0233e147456e73ded69e1869d192`. Phase 9 closes scripting,
parsing, trigger, regex, and Lua ownership through
`3963a1278b5f15175c295e3707d25fbf07bdcb56`. Phase 10 closes extension, module,
MCP, OAuth, and specialized-tool ownership through
`e8bbbeea6ad400234aa4d0abad330356265c3c23`. Phase 11 closes portable formats,
assets, import/export, salvage, and backups through
`56287bcb62c1dcdb969a7d185371a1c539bf3200`. Phase 12 closes runtime, route
policy, limits, diagnostics, Push, and signed no-port ownership through
`1430b714855f4df208a07f54df4653a681a04351` and
`140c04d24724fcb09cef9ad57fd38bcc976054f6`. Phase 13 closes register lifecycle
governance, all historical evidence, and all 85 current upstream dispositions
through `d8d00b60b63f7905ff45de9a9b88aa8814c2d82b`. Phase 14's final behavioral
candidate is `a6b9cdcc074d4033c511509171268a821aa11d3c`. The exact whole-product,
pinned differential, browser, build, typecheck, formatting, and register
manifest passes at that candidate with no unexplained difference. All registers
are closed, the intact workstream is archived, and its permanent consumers and
internal links remain fail-closed repository gates.

## Phase 0 Environment And Baseline Evidence

| Check | Result |
| --- | --- |
| Fastify evidence commit | `9ea7aa20dd5a93ac7e5c9112e8c8fbcb9fca1438` |
| Compatibility baseline | `71c476e9c86263fe907105b011ca4dde0a619d66` |
| Behavioral sync cursor | `f3f0242fba297d82e0efcc2c31ca1428569b70f2` |
| Node | `v24.19.0` |
| pnpm | `11.23.0` |
| Pinned baseline worktree | Clean, detached, exact at `/home/codex/risu-baseline-71c476e9c` |
| Moving upstream checkout | Left untouched at `/home/codex/Risuai`; not used as fork-point output authority |
| Baseline preparation | `pnpm prepare:compat-baseline` is idempotent and fails closed on wrong commit, attached branch, dirty state, or missing dependencies |
| Full differential | Passed: 16 baseline tests; 18 current/cluster tests; 16 compared cells; 15 explained divergences; cluster 10 healthy |

## Phase 0 Validation

| Command/check | Result |
| --- | --- |
| `pnpm exec vitest run util/compat-baseline.test.ts` | Passed; 6 tests |
| `pnpm exec tsx util/compat-baseline.ts --check` | Passed against the detached baseline |
| `pnpm exec vitest run util/validate-original-risu-compatibility-registers.test.ts` | Passed; 12 tests, including missing/null/order/repeated-value/endpoint negative cases |
| `pnpm validate:compat-registers` | Passed; 85 upstream units, 77 surfaces, 59 decisions, 14 findings, and 75 unique raw mappings |
| Pilot-focused Fastify Vitest command over seven owning files | Passed; 7 files and 522 tests |
| `pnpm check:server` | Passed protocol, client-declaration, browser-smoke, and Fastify typechecks |
| `pnpm test:affected --dry-run --base 9022d5bb45660ba50784e2324c93d339e75c96f9` | Selected the same seven pilot Fastify test files |
| `pnpm test:compat-harness` | Passed full pinned differential; counts recorded above |
| `pnpm exec prettier --check` for Phase 0 changes | Passed |
| `git diff --check` | Passed |

The pilot's direct Original-app reroll save exchange is not executable because
the pinned baseline harness mocks rerolls and exposes no save-exchange path. The
current codec test covers every supported `.risu` envelope and records this
specific residual/revisit condition rather than claiming unrun proof.

## Phase 1 Evidence

| Check | Result |
| --- | --- |
| Phase 1 closure and classified fixture provenance | `546ea5aaee78144176043971fdd2c13c9e7c6079` |
| Harness and governance foundation | `b0f06552dc84fc8c406c7279cd6330519d6c4db1` |
| Affected and aggregate ownership commit | `6ddc82431230ee40cf9c4151d3388baab0162998` |
| CI, cadence, and release-equivalent ownership commit | `328a70787c26051525a713fc86311fe672dd7b8b` |
| Semantic production correction | `c33dac56811c3c6c6bdf72f8ad3faac796abfe59` |
| Prompt preview/persistence contract follow-up | `5b6a9d492beb399a58d9695097171a9c3edf1b4d` |
| Category A inventory | 8 verified rows, `ORC-SURFACE-078` through `ORC-SURFACE-085`; total inventory 85 rows |
| Shared case matrix | 16 ordered cells: four scenarios × two transports × say-nothing enabled/disabled |
| Fixture/golden authority | 16 provenance case IDs, 6 governed manifest files, 23 decision-backed cell/aspect mappings |
| CI cadence | Main quality owns registers/current; full pinned differential runs daily at 06:00 UTC and by manual dispatch, with 14-day artifacts |
| Release-equivalent rule | Main quality and the full pinned differential must both succeed for the exact candidate revision |

## Phase 1 Validation

| Command/check | Result |
| --- | --- |
| `pnpm prepare:compat-baseline -- --check` | Failed as an invalid invocation: the package script already appends `--prepare`, so forwarding `-- --check` produced the fail-closed CLI usage error |
| `pnpm prepare:compat-baseline` | Passed; verified the clean detached baseline at `71c476e9c86263fe907105b011ca4dde0a619d66` |
| `pnpm exec tsx util/compat-baseline.ts --check` | Passed; direct read-only verification of the same clean detached baseline |
| `pnpm exec vitest run util/compat-baseline.test.ts test/compat-harness/governance.test.ts test/compat-harness/normalize.test.ts util/validate-original-risu-compatibility-registers.test.ts util/affected-tests.test.ts util/test-all.test.ts` | Passed; 6 files and 59 tests |
| `pnpm validate:compat-registers` | Passed; 85 upstream units, 85 inventory surfaces including all 8 Category A owners, 59 decisions, 15 findings, and 75 unique raw mappings |
| `pnpm test:affected --dry-run --base c33dac56811c3c6c6bdf72f8ad3faac796abfe59` | Passed; CI/config changes fail closed to `pnpm test:all` plus `pnpm test:compat-harness` |
| `pnpm test:all --dry-run` | Passed; 11 lanes, including register validation and an isolated current harness after registers |
| `pnpm test:compat-current` | Passed; 2 files and 18 tests, 16 current cells, cluster 10 healthy |
| `pnpm test:compat-harness` | Passed; baseline 1 file/16 tests and current 2 files/18 tests, 16 compared cells, 15 governed divergences, cluster 10 healthy |
| `pnpm exec prettier --check` for Phase 1 closure files | Passed |
| `git diff --check` | Passed |

The failed baseline command is retained because it corrected the command
contract: use the package script for prepare mode and the direct CLI for check
mode. It did not weaken or bypass baseline verification.

## Phase 2 Evidence

| Check | Result |
| --- | --- |
| Bootstrap projection and recovery-lineage implementation | `3ce85c1f034b3afc493e291f8a8f5e9227064463` |
| Partial-object projection correction and completion commit | `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74` |
| Category B inventory | New verified rows `ORC-SURFACE-086` through `ORC-SURFACE-088`; historical rows `ORC-SURFACE-023` and `ORC-SURFACE-072` re-verified |
| Projection coverage | Shell, full-settings, cache, settings-group, and standalone reads; missing/null/empty/malformed/legacy values; selected-character bounds |
| Recovery coverage | Command response and SSE lineage; offline-before-send; response-lost-after-commit; replay gap; reload; observer denial and writer takeover |

## Phase 2 Validation

| Command/check | Result |
| --- | --- |
| Initial `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts` | Failed before `f25376ef3`: 229 passed, 1 failed; a valid partial `customTextTheme` object was replaced by its default during later bootstrap projection |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/resourceReads.test.ts server/fastify/__tests__/commands.test.ts` | Passed after the correction; 2 files and 251 tests |
| `pnpm exec vitest run src/ts/server/commands.test.ts src/ts/server/events.test.ts` | Passed; 2 files and 176 tests, including lineage preservation/rejection and exact BardWiki eventless receipts |
| `pnpm exec vitest run src/ts/server/chatMessageHydration.test.ts src/ts/server/lifecycleRecovery.test.ts src/ts/server/pendingMutationOutbox.test.ts src/ts/server/pendingMutationOutbox.crossTab.test.ts src/ts/server/lorebookBridge.svelte.test.ts` | Passed; 5 files and 415 tests |
| `pnpm build:smoke && pnpm exec playwright test -c playwright.fastify-smoke.config.ts server/fastify/browser-smoke/startupRecoveryIntegrationMatrix.spec.ts` | Passed on current re-verification commit `5eca30f4872e865efee2c86f4dde7ae71e915f9a`; all 8 built-browser recovery tests, including direct-link hydration, legacy/null shell repair, response loss, replay gap, observer takeover, and background-runtime failure |
| `pnpm check:server` | Passed for the Phase 2 implementation and projection correction |
| `pnpm test:compat-harness` | Passed after the correction at `f25376ef3`: 16 baseline tests, 18 current/cluster tests, 16 compared cells, 15 governed divergences, cluster 10 healthy |

The failed server command run is retained because it exposed a Phase 2
production regression rather than a harness-only issue. The correction preserves
valid partial object values while continuing to default malformed strict-shell
fields, and the owning 251-test lane then passed.

## Phase 3 Evidence

| Check | Result |
| --- | --- |
| Closed-world command, field, schema, event, replay, and bridge ownership | `958f8585138ec817fe5d134563df585434ed5821` |
| Exact BardWiki eventless receipt correction | `3f20a80b780f2538fd1e38aa6514d9a9f894985a` |
| Completion verification commit | `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74` |
| Command vocabulary | 161 unique production command routes with an exact digest and five reviewed mutation policies |
| Durable state vocabulary | 422 logical Database fields; identical browser/server writable-setting catalogs; 46 SQLite tables with exact column digest |
| Event vocabulary | 146 event type/resource pairs; every browser reconciliation branch classified; five legacy Agent Preset step events replay-only |
| Bridge vocabulary | Six built-in editing bridges with durable staging, rollback, lifecycle flush, and focused regression owners |
| Category C inventory | New verified rows `ORC-SURFACE-089` through `ORC-SURFACE-093`; historical rows `ORC-SURFACE-024`, `ORC-SURFACE-025`, `ORC-SURFACE-061`, and `ORC-SURFACE-073` re-verified |

## Phase 3 Validation

| Command/check | Result |
| --- | --- |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/phase3CompatibilityStructure.test.ts server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts` | Passed; 2 files and 22 tests |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/resourceReads.test.ts server/fastify/__tests__/commands.test.ts` | Passed; 2 production owner files and 251 tests |
| `pnpm exec vitest run src/ts/server/commands.test.ts src/ts/server/events.test.ts` | Passed; 2 browser command/event files and 176 tests |
| `pnpm check:server` | Passed after the structural and receipt corrections |
| `pnpm test:compat-harness` | Passed at the completion commit; exact differential counts are recorded in Phase 2 Validation above |
| `pnpm validate:compat-registers` | Passed with 93 inventory rows, 59 linked decisions, 15 findings, 85 upstream units, and all 75 raw reports mapped exactly once |
| `pnpm exec vitest run util/validate-original-risu-compatibility-registers.test.ts` | Passed; 1 file and 12 fail-closed register tests |
| `pnpm exec prettier --check` for the Phase 2-3 closure files | Passed |
| `git diff --check` | Passed |

## Phase 5 Evidence

| Check | Result |
| --- | --- |
| Closed settings and authoring ownership | `b34b7a78f28cb5903ece3880073fbb9e46392cb8` |
| Visible built-browser character authoring and reload | `5eca30f4872e865efee2c86f4dde7ae71e915f9a` |
| Category E inventory | New verified rows `ORC-SURFACE-094` through `ORC-SURFACE-096`; pilot row `ORC-SURFACE-001` re-verified; total inventory 96 rows |
| Database/settings ownership | All 422 retained fields classified; browser/Fastify readable and writable groups exact and duplicate-free; Agent/model derived read-only projections explicit |
| Preset catalogs | 82 legacy apply fields, 65 model fields, 20 prompt fields, and 41 prompt-model override fields close over retained Database owners |
| Defaults and legacy settings | 15 retained initial defaults, seven semantically omitted defaults plus the Agent Preset pointer, 13 no-control settings, and imported `pip` normalization explicitly pinned |
| Authoring collections | All 11 repository collections have a command prefix, SQLite table, and deeper domain owner; character/Agent/persona/lorebook/prompt owners remain targeted |
| Character reload | Visible editor name/description/first-message edits receive the real Fastify character `PATCH`, preserve `chaId`, and survive full reload |
| Realm/catalog/upload | Empty/failure/stale/confirmation outcomes, returned-id navigation, JSON/CharX staging and cleanup, upload idempotence/rollback, and inlay-catalog revisions re-verified |

Runtime use of profile options remains cross-owned by Phases 6 and 7; Hypa V3,
module/plugin lifecycle, and portable artifact bytes remain cross-owned by
Phases 8, 10, and 11. Signed character/module conversion
`ORC-DECISION-058` remains Category J Phase 10 verification work. Phase 5
neither relies on that unsupported boundary nor on Phase 4's independently
governed responsive-shell decision.

## Phase 5 Validation

| Command/check | Result |
| --- | --- |
| `pnpm test:server` | Passed; 172 files and 3,556 tests, with one isolated Realm scale case skipped in the ordinary lane |
| `pnpm exec vitest run --project frontend-dom src/ts/storage/database.svelte.test.ts src/ts/persona.test.ts src/ts/characterCommands.test.ts src/ts/characterCards.realmImport.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/providerSecretMask.test.ts` | Passed; 5 selected DOM files and 379 tests; the Node-owned secret-mask file was routed separately below |
| `pnpm exec vitest run --project frontend-node src/ts/providerSecretMask.test.ts` | Passed; 1 file and 2 tests |
| `pnpm build:smoke && pnpm exec playwright test -c playwright.fastify-smoke.config.ts server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts -g 'authored character identity fields survive command acceptance and a full reload'` | Passed; production smoke build and 1 built-browser test |
| Initial `pnpm test:compat-harness` | Failed after both runners passed because Phase 2 decision `ORC-DECISION-020` had gained `ORC-SURFACE-087` while its governed cell mappings still named only `ORC-SURFACE-024` |
| Governance correction | `7ba933fe6f1c3338bd9cce2ef308b2b216ac8e8d` linked the recovery-lineage inventory owner in the expected-difference mappings as an independent Phase 2 correction |
| Repeated `pnpm test:compat-harness` | Passed; 16 baseline tests, 18 current/cluster tests, 16 compared cells, 15 governed divergences, cluster 10 healthy |
| `pnpm check:server` | Passed at the Phase 5 structural anchor |
| `pnpm validate:compat-registers` and fail-closed register Vitest | Passed; 96 inventory rows, 59 decisions, 15 findings, 85 upstream units, all 75 historical raw reports mapped, and 12 fail-closed validator tests |
| Phase 5 Prettier check and `git diff --check` | Passed |

## Phase 4 Evidence

| Check | Result |
| --- | --- |
| Closed route/control inventory | `e9901b0f68acc405cef8a8af642eb40f83e8affb` |
| Visible pre-token provider failure and Retry | `477a3aece1fffc159b0354fef5b21ecddf60cab5` |
| Signed responsive-shell classification | `6487cba00e3cc435a3c4f57f8121663bcdccc57e` |
| Category D inventory | New verified rows `ORC-SURFACE-097` through `ORC-SURFACE-099`; total inventory 99 rows |
| Decision authority | `ORC-DECISION-060` is signed from RH+ commit `2073b5fb6a755516b80e48509c6e0a322f062677`; the four previously proposed historical decisions also have reconstructed individual maintainer commits and are now signed |
| Visible lifecycle | Real production bundle, Fastify routes, SQLite, SSE, error modal, recovery banner, Retry confirmation, partial/final transcript, reload, concurrent chat, and reroll persistence |

## Phase 4 Validation

| Command/check | Result |
| --- | --- |
| Focused route/App/sidebar/composer/reroll/hotkey Vitest selection | Passed; 8 files and 156 tests |
| `pnpm exec playwright test -c playwright.fastify-smoke.config.ts server/fastify/browser-smoke/acceptedSendProtocol.spec.ts` | Passed; 11 tests |
| `pnpm exec playwright test -c playwright.fastify-smoke.config.ts server/fastify/browser-smoke/rerollSwipePersistence.spec.ts` | Passed; 1 test |
| `pnpm validate:compat-registers` | Passed with 99 inventory rows, 60 signed decisions, 15 findings, 85 upstream units, and all 75 historical raw reports mapped |
| Fail-closed register Vitest | Passed; 1 file and 12 tests |
| Formatting and `git diff --check` | Passed |

## Phase 6 Evidence

| Check | Result |
| --- | --- |
| Closed prompt and lifecycle structure plus durable fault regressions | `19ba37af26df7db60d7393976d61b520a785076b` |
| Visible pre-token provider failure and billing-aware Retry | `477a3aece1fffc159b0354fef5b21ecddf60cab5` |
| Category F inventory | New verified rows `ORC-SURFACE-100` through `ORC-SURFACE-102`; all 25 historical Category F decision/finding rows re-verified; 28 verified Category F rows and 102 total inventory rows |
| Prompt structure | Nine assembly stages; every effective-config, transform, Agent Preset, template/role, static, history, lore, memory, CBS, script, bias, stop, asset, provider-ready, and budget contributor has a production owner |
| Generation structure | Five actions, nine styles, twelve durable operation states, five finalization projections, seven effect kinds, and thirteen protocol stream events are closed over production owners |
| Durable lifecycle | Send/continue/regenerate identity, append/extend styles, multi-result, cancellation, disconnect, reattach, restart, stale/deleted targets, queued finalization, and exact effect application are pinned |
| Signed boundary | `ORC-DECISION-061` is signed from RH+ commit `ec124302cbe49e718228322ca22b32a2ddf74d6e`: imported `Character.additionalText` remains preserved/read-only and omitted from prompts |
| Visible lifecycle | The production-bundle accepted-send matrix retains one accepted user row through pre-token failure and Retry, shows billing confirmation, and makes exactly two provider calls |

## Phase 6 Validation

| Command/check | Result |
| --- | --- |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/phase6CompatibilityStructure.test.ts server/fastify/__tests__/durableGeneration.test.ts` | Passed; 2 files and 71 tests |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts` over generation chat, assembly, effects, and finalization-retry owners | Passed; 4 files and 328 tests |
| Auto-routed group prompt-preflight owner | Passed; 1 file and 37 tests |
| `pnpm exec vitest run --project frontend-dom` over storage and character-config owners | Passed; 2 files and 169 tests, including group rejection plus preserved/read-only additional information |
| Focused Fastify retired-additional-information prompt omission | Passed; 1 selected test |
| `pnpm exec playwright test -c playwright.fastify-smoke.config.ts server/fastify/browser-smoke/acceptedSendProtocol.spec.ts` | Passed at the browser anchor; 11 tests |
| `pnpm check:server` | Passed at the Phase 6 structural anchor and on closure |
| `pnpm test:compat-harness` | Passed; 16 baseline tests, 18 current/cluster tests, 16 compared cells, 15 governed divergences, cluster 10 healthy |
| Category F closure check | Passed; zero Category F rows remain mapped-only |
| `pnpm validate:compat-registers` and fail-closed register Vitest | Passed; 102 inventory rows, 61 signed decisions, 15 findings, 85 upstream units, all 75 historical raw reports mapped, and 12 validator tests |
| Phase 6 Prettier check and `git diff --check` | Passed |

## Phase 7 Evidence

| Check | Result |
| --- | --- |
| Closed provider, option, operation, translation, and media structure | `fe7825f3da4bdd2aceb090fc6eaaa9b2cf5a6050` |
| Category G inventory | New verified rows `ORC-SURFACE-103` through `ORC-SURFACE-105`; all 13 historical mapped-only Category G rows re-verified; 18 verified Category G rows and 105 total inventory rows |
| Model and adapter vocabulary | 24 retained `LLMFormat` values, 15 admitted text adapters or explicit browser-only dispositions, and nine first-class profile-provider ids |
| Option and request ownership | Every profile provider option and runtime option has a materialization/consumer owner; deterministic provider tests retain endpoint, credentials, headers, model, roles, body options, stream, fallback, cancel, and error semantics |
| Fixed operations | All 18 provider operations have a production dispatcher and sanitized request-capture owner |
| Translation and media | Four raw translator kinds, five detached/browser translation lifecycle owners, eight image providers, five TTS operations, and fixed Whisper VTT transcription are closed over production and assurance owners |
| Signed boundaries | `ORC-DECISION-006` keeps browser-only provider paths out of Fastify; `ORC-DECISION-059` retains the curated catalog and inert `dynamicOutput` classification |

## Phase 7 Validation

| Command/check | Result |
| --- | --- |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/phase7CompatibilityStructure.test.ts` | Passed; 1 file and 6 closed-world tests |
| Focused Fastify provider/operation/translation/media selection | Passed; 11 files and 249 tests |
| Focused browser/runtime profile, translation, speech, and media selection | Passed; 11 files and 205 tests |
| `pnpm exec playwright test -c playwright.fastify-smoke.config.ts server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts --grep 'translator preset bindings persist independently across chats'` | Passed; 1 production-bundle browser test |
| `pnpm test:affected --dry-run --base fe7825f3d^` | Selected the Phase 7 structural server test plus compatibility register validation and its fail-closed tests |
| `pnpm check:server` | Passed at the Phase 7 implementation anchor |
| Category G closure check | Passed; 18 of 18 Category G rows verified and zero remain mapped-only |
| Register validation, Prettier, and `git diff --check` | Passed after the Category G register update; 105 inventory rows, 61 signed decisions, and 15 findings |

## Phase 8 Evidence

| Check | Result |
| --- | --- |
| Closed memory, embedding, BardWiki, job, and worker structure | `a77f47c9f79b0233e147456e73ded69e1869d192` |
| Category H inventory | New verified rows `ORC-SURFACE-106` through `ORC-SURFACE-108`; all four historical Category H rows re-verified; 7 verified Category H rows and 108 total inventory rows |
| Retained memory vocabulary | Standard Hypa planner, five explicitly retired algorithms, all 18 embedding aliases, four selection categories, three BardWiki modes, and nine score reasons |
| Queue vocabulary | Three memory kinds, three BardWiki kinds, all five states and terminal states, with retry/exhaustion, cancellation, restart, duplicate delivery, stale invalidation/reconciliation, and diagnostics owned |
| Real restart persistence | A running job survives SQLite close/reopen, is recovered once at Fastify start, completes at attempt count 2, and remains completed after another reopen |
| Signed boundaries | Decision owners corrected for conventional lore regex parsing, raw Hypa summary rows, worker-deferred summaries, and invalid-ratio clamp diagnostics |

## Phase 8 Validation

| Command/check | Result |
| --- | --- |
| Changed-file Phase 8 selection | Passed; 4 files and 112 tests |
| Full memory/BardWiki/assembly/lorebook owning selection | Passed; 37 files and 563 tests |
| Commands plus generation persistence/integration selection | Passed; 2 files and 411 tests |
| Retired-memory browser assurance | Passed; 1 file and 3 tests |
| `pnpm check:server` | Passed after the Phase 8 structural test |
| Category H closure check | Passed; 7 of 7 Category H rows verified and zero remain mapped-only |
| Register validation, Prettier, and `git diff --check` | Passed after the Category H register and decision-owner update; 108 inventory rows, 61 signed decisions, and 15 findings |

## Phase 9 Evidence

| Check | Result |
| --- | --- |
| Scripting compatibility implementation | `08d04efbf6bcc0f64c706bafe454a8649f9971be` |
| Closed CBS, trigger/effect, regex, and Lua structure | `3963a1278b5f15175c295e3707d25fbf07bdcb56` |
| Category I inventory | New verified rows `ORC-SURFACE-109` through `ORC-SURFACE-117`; all nine historical Category I rows re-verified; 18 verified Category I rows and 117 total inventory rows |
| CBS vocabulary | 176 registrations, 151 executable callbacks, and 245 normalized matcher names, each with one owner |
| Trigger vocabulary | 118 effect kinds, six modes, four condition kinds, four regex stages, and 40 explicitly unsupported effect kinds |
| Lua vocabulary | 54 identical browser/Fastify host declarations, exhaustively classified as supported, browser-UI no-op, interactive rejection, or media-read rejection |
| Shared compatibility proof | One state-independent corpus plus exact baseline/current fixtures for group, history, reverse, metadata, slot, each budget, malformed `fmIndex`, and Lua failure behavior |
| Signed differences | `ORC-DECISION-062` through `ORC-DECISION-067` record exact RH+ authority; `ORC-DECISION-005` now also owns group-aware parser retirement |

The only difference without an exact maintainer authority was malformed data
missing `fmIndex`; it was restored to baseline parity. Locale-sensitive matcher
folding has no demonstrated registered-name outcome, and the authorized shallow
history clone is byte-identical, so neither is recorded as an unexplained
observable difference.

## Phase 9 Validation

| Check | Result |
| --- | --- |
| Phase 9 Fastify selection | Passed; 6 files and 359 tests |
| Shared browser corpus and baseline-drift selection | Passed; 2 files and 24 tests |
| `pnpm test:compat-harness` | Passed; 29 baseline tests, 18 current/cluster tests, 16 compared cells, 15 governed harness divergences, cluster 10 healthy |
| `pnpm check` | Passed with 0 errors and 0 warnings |
| `pnpm check:server` | Passed protocol, client-declaration, browser-smoke, and Fastify typechecks |
| Category I closure | Passed; 18 of 18 Category I rows verified and zero remain mapped-only |
| Register gates | Passed; 117 surfaces, 67 signed decisions, 15 findings, and 12 fail-closed validator tests |
| Phase 9 Prettier and `git diff --check` | Passed |

## Phase 10 Evidence

| Check | Result |
| --- | --- |
| Specialized-tool hardening | `397e06c67694f59d96a087ea1974802e5e0bd4c6` |
| Closed Plugin/module/MCP/tool structure | `e8bbbeea6ad400234aa4d0abad330356265c3c23` |
| Category J inventory | Historical no-port row `ORC-SURFACE-062` re-verified; new verified rows `ORC-SURFACE-118` through `ORC-SURFACE-121`; 5 verified Category J rows and 121 total inventory rows |
| Plugin V3 vocabulary | 85 direct API keys, nine permissions, four runtime phases, seven RPC message types, V3-only client/server gate, and iframe CSP |
| Module vocabulary | Seven activation sources plus create/import/edit/enable/reorder/select/delete/reload/export and MCP-restriction owners |
| MCP vocabulary | Four identifier classes, six internal clients, call-only/duplicate/cancel rules, OAuth refresh, DNS-pinned egress, and exact specialized/Risu-access tool catalogs |
| Concrete corrections | Bounded/strict Dice notation, bounded/fail-closed GraphMem, and an advertised file-system recovery path |
| Signed no-port | `ORC-DECISION-058` retains absent character/module conversion and CharX module interchange while `.risum` import/export remains supported |

Trusted Plugin V3/CSP behavior, module lifecycle, remote MCP protocol seams, and
specialized-tool authority are deterministic. Normal CI does not execute
hostile third-party code, a real remote OAuth MCP server, paid services, or an
operating-system directory picker; these are explicit residuals rather than
unowned surfaces.

## Phase 10 Validation

| Check | Result |
| --- | --- |
| Phase 10 structural gate | Passed; 1 file and 4 tests |
| Specialized-tool and file-system regressions | Passed; 2 files and 12 tests |
| Browser Plugin/module/MCP lane | Passed; 23 files and 426 tests |
| Fastify command/module/plugin-network/OAuth lane | Passed; 7 files and 308 tests |
| `pnpm check` and `pnpm check:server` | Passed with 0 frontend errors/warnings and all server/browser-smoke typechecks |
| Category J closure | Passed; 5 of 5 Category J rows verified and zero remain mapped-only |
| Register gates | Passed; 121 surfaces, 67 signed decisions, 15 findings, and 12 fail-closed validator tests |
| Phase 10 Prettier and `git diff --check` | Passed |

## Phase 11 Evidence

| Check | Result |
| --- | --- |
| Portable-format, asset-integrity, and atomic-import implementation | `56287bcb62c1dcdb969a7d185371a1c539bf3200` |
| Category K inventory | New verified rows `ORC-SURFACE-122` through `ORC-SURFACE-124`; all nine historical mapped Category K rows re-verified alongside pilot `ORC-SURFACE-004`; 13 verified Category K rows and 124 total inventory rows |
| Envelope/block vocabulary | Four supported envelopes and every `RisuSaveBlockType`, each classified for import and export |
| Asset vocabulary | Every declarative owner plus nine specialized owner shapes shared by reference discovery and legacy-path rewriting |
| Backup vocabulary | Every live SQLite table included in backup or deliberately excluded with a nonempty reason |
| Export integrity | Pre-response size/SHA preflight plus streaming verification; corrupt preflight returns 400 and post-preflight mutation aborts ZIP/legacy streams |
| Import atomicity | Bounded database/entry/record/name/version/hash validation, staged-byte cleanup, deduplicated-live preservation, no failed replacement, safety snapshot, fresh reopen, and qualified salvage |
| Historical boundaries | Credential inclusion/scrubbing, inert CharX exclusions, cold-chat export, incomplete restore, standalone CHAT salvage, Agent-only lore, and monolithic-preset migration independently re-verified |

The pinned Original harness has no executable save exchange because it mocks
rerolls. Every supported current codec independently proves portable reroll
candidate round trips; the exact cross-application limitation remains recorded
instead of being normalized or overclaimed.

## Phase 11 Validation

| Check | Result |
| --- | --- |
| Structure, bundle export, and bundle import selection | Passed; 3 files and 61 tests |
| Asset-reference, legacy-database, and codec selection | Passed; 3 files and 51 tests |
| Complete Phase 11 selection | Passed; 6 files and 112 tests |
| `pnpm check:server` | Passed at the implementation anchor |
| Category K closure | Passed; 13 of 13 Category K rows verified and zero remain mapped-only |
| Register gates | Passed; 124 surfaces, 67 signed decisions, 15 findings, and 12 fail-closed validator tests |
| Phase 11 Prettier and `git diff --check` | Passed |

## Phase 12 Evidence

| Check | Result |
| --- | --- |
| Push boundary hardening and persisted reopen evidence | `8820b3e8c2cd1452b155b56167c66292e3029cdf` |
| Closed runtime/platform/limit/diagnostic structure | `1430b714855f4df208a07f54df4653a681a04351` |
| Signed no-port absence gate | `140c04d24724fcb09cef9ad57fd38bcc976054f6` |
| Category L inventory | New verified rows `ORC-SURFACE-125` through `ORC-SURFACE-134`; 10 verified Category L rows and 134 total inventory rows |
| Route/runtime vocabulary | Exact method/path/auth/writer/stream classes, 15 rate limits, 19 startup steps, five readiness capabilities, and nine baseline runtime features |
| Limit/recovery ownership | Request/body/import/stream/backpressure/retention bounds plus restore-before-backfill, reconciliation-before-routes, runner-settle-before-close, and persisted session/Push reopen |
| Diagnostic ownership | Request trace/history, generation sidecar, startup telemetry, retention pruning, and protected production-bundle negatives |
| Web Push | Permission/fallback/cleanup, pre-parse auth, 16 KiB body cap, bounded HTTPS endpoint/keys, 10-second timeout, persisted VAPID/subscription, and expired-subscription prune |
| Signed products | `ORC-DECISION-068` wrapper runtimes; `069` PeerJS rooms; `070` Account/Drive cloud sync; `071` browser-local authoritative persistence |

The four no-port records use their exact originating RH+ commits and remain
narrow. They do not retire responsive mobile web, command/SSE synchronization,
server/portable backup, unrelated account/Google features, retained scoped
browser recovery/cache state, PWA presentation, or Web Push.

## Phase 12 Validation

| Check | Result |
| --- | --- |
| Phase 12 structural/no-port gate | Passed; 1 file and 4 tests |
| Focused auth/Push/structure selection | Passed; 3 files and 24 tests before the final no-port assertion; structural file passed again afterward |
| Expanded Fastify runtime/diagnostic lane | Passed; 6 files and 54 tests |
| Browser platform/diagnostic lane | Passed; 6 files and 57 tests |
| `pnpm check` and `pnpm check:server` | Passed with 0 frontend errors/warnings and all server/browser-smoke typechecks |
| Category L closure | Passed; 10 of 10 Category L rows verified |
| Register gates | Passed; 134 surfaces, 71 signed decisions, 15 findings, and 12 fail-closed validator tests |
| Phase 12 Prettier and `git diff --check` | Passed |

## Phase 13 Evidence

| Check | Result |
| --- | --- |
| Fail-closed lifecycle semantics | `473f88478a22ce3bb851e5ab3e1323addd15fbbf` |
| Historical inventory/finding closure | `7bf742dd0e8bb37aa6d29fc40c97c4f49fbace5d` |
| Component-wise upstream adjudication and Phase 14 manifest | `50b24164f06c93b425c65ae14dad034c1af01715` |
| Current upstream register | `d8d00b60b63f7905ff45de9a9b88aa8814c2d82b` |
| Inventory | 134 verified rows; zero mapped, pending-finding, decision-required, or unowned rows |
| Findings and decisions | 15 resolved findings with current evidence; 71 signed decisions; 75 raw reports mapped once |
| Upstream range | 85 exact first-parent units: 47 verified and 38 currently not applicable; zero pending, finding, or decision-required units |

## Phase 13 Validation

| Check | Result |
| --- | --- |
| Closed-state register validator | Passed; 1 file and 13 tests, including unfinished-closure negatives |
| Category D browser owners | Passed; 7 files and 185 tests |
| Complete Fastify lane during consolidation | Passed; 178 files and 3,648 tests, with one skip |
| Upstream browser-side owners | Passed; 25 files and 677 tests |
| `pnpm test:affected --dry-run` and selected register lane | Passed; schema validator and fail-closed tests selected and passed |
| `pnpm validate:compat-registers` | Passed after all current upstream outcomes were published |
| Phase 13 Prettier and `git diff --check` | Passed |

## Phase 14 Evidence

| Check | Result |
| --- | --- |
| Final Fastify behavioral candidate | `a6b9cdcc074d4033c511509171268a821aa11d3c` |
| Register closure | `22d3164a285eaf4abbc5322d21b041b2eef889d4` |
| Intact archival | `b0eb22aafdb56c15d1041937cff61d2c2381b521` |
| Permanent archived-link validation | `282d66c88adbf41f1f0628af99c838e165350e1b` |
| Final recovery correction | `a6b9cdcc074d4033c511509171268a821aa11d3c` |
| Toolchain | Node `v24.19.0`; pnpm `11.23.0` |
| Pinned baseline | Clean detached worktree at `71c476e9c86263fe907105b011ca4dde0a619d66` |
| Inventory and findings | 134 verified surfaces; 15 resolved findings; 71 signed decisions; 75 historical raw reports mapped exactly once |
| Upstream adjudication | 85 exact first-parent units: 47 verified and 38 currently not applicable |
| Differential verdict | 16 compared cells; 15 signed expected differences; cluster 10 healthy; zero unexplained differences |
| Initial preload | 11 files; 330.73 KiB gzip; protected boundaries, regression ceilings, and milestone gates passed |

## Phase 14 Validation

| Command/check | Result |
| --- | --- |
| `pnpm prepare:compat-baseline` | Passed; exact detached baseline present, clean, and dependency-ready |
| `pnpm exec tsx util/compat-baseline.ts --check` | Passed against the same pinned worktree |
| `pnpm validate:compat-registers` | Passed before closure with all register contents complete |
| `pnpm test:affected --dry-run` and `pnpm test:affected` | Passed; clean exact-candidate tree had no uncommitted selection |
| `pnpm test:compat-current` | Passed; 2 files, 18 tests, 16 current cells, cluster 10 healthy |
| `pnpm test:compat-harness` | Passed; 3 baseline files/29 tests and 2 current files/18 tests; 16 cells, 15 governed differences, cluster 10 healthy |
| `pnpm test:all` | Passed in 4m 23.1s: 544 frontend files/6,688 tests; 178 Fastify files/3,648 tests plus one skip; 41 browser journeys; 6 UI-map files/206 tests; Realm scale and 6 performance-gate tests; register, current-harness, typecheck, coverage, format, and frontend-check lanes |
| `pnpm smoke:fastify-browser` | Passed; production smoke build and all 41 browser journeys |
| `pnpm build:initial-preload` | Passed; HTML preload closure and protected boundaries passed; 330.73 KiB gzip total and 282.48 KiB largest file, within both ceilings |
| `pnpm check` | Passed with 0 errors and 0 warnings |
| `pnpm check:server` | Passed protocol, client declarations, Fastify, and browser-smoke typechecks |
| `pnpm check:protocol` | Passed |
| `pnpm format:check` and `git diff --check` | Passed |

The first aggregate attempt admitted the Phase 9 baseline-only test to the
ordinary frontend lane and used a test-watch fixture that did not model the
current compatibility command. `55b93ff24ba98416a327d1cda1ac3b576e9229e2`
fixed both test-graph defects; the repeated aggregate then passed. The first
standalone browser run subsequently exposed a real test-helper race: a durable
write could advance the global revision between bootstrap and a concurrent
chat-settings PUT. `309823d6d3551638ce63888569f0a8790bf2fe3a` bounded retries to
authoritative revision-conflict responses. The raced journey passed three
repetitions, its 11-test owning spec passed, and both the exact standalone smoke
command and the then-current aggregate passed all 41 journeys.

After register closure, documentation synchronization, intact archival, and the
permanent Markdown-link gate, the next aggregate exposed two production
recovery races. A strict transcript hydration could acknowledge and clear a
queued finalization marker before a later effect claim reported transient
unavailability, leaving no timer owner for the pending effects. Separately, a
newer transcript projection could truthfully invalidate the first strict
terminal hydration after the observer job had already disappeared, publishing
a permanent recovery warning despite authoritative completion.
`a6b9cdcc074d4033c511509171268a821aa11d3c` keeps all nonterminal effect results
retryable, restores only a missing queued/stalled trigger after failed recovery,
and retries only failed terminal chat hydrations once. The three focused files
pass 58 tests; each raced browser journey passed ten repetitions; the complete
11-test accepted-send browser owner passed; the pinned differential and initial
preload gates passed; and the repeated exact aggregate passed all lanes and all
41 browser journeys. This commit therefore supersedes `309823d6d` as the final
behavioral candidate.

## Update Rules

- Record exact commands, commit, environment, counts, artifacts, and failures.
- Preserve failed attempts that change an audit decision or expose a harness flaw.
- Separate current-only results from fork-point differential results.
- Never report a baseline parity result when the pinned baseline did not run.
- Move historical command records into phase/slice evidence only after verifying
  them against the current tree.
