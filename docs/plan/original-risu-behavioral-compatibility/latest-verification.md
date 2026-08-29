# Original RisuAI Behavioral Compatibility Latest Verification

Date: 2026-08-30

## Current Verdict

Phases 0 through 8 are complete. Phase 2 state/recovery implementation
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
ownership at `a77f47c9f79b0233e147456e73ded69e1869d192`, and Phase 9 is in
progress.

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

## Update Rules

- Record exact commands, commit, environment, counts, artifacts, and failures.
- Preserve failed attempts that change an audit decision or expose a harness flaw.
- Separate current-only results from fork-point differential results.
- Never report a baseline parity result when the pinned baseline did not run.
- Move historical command records into phase/slice evidence only after verifying
  them against the current tree.
