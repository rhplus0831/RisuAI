# Original RisuAI Behavioral Compatibility Audit Status

Date: 2026-08-30

This is the live execution router. Keep stable scope, taxonomy, evidence rules,
and stopping gates in [`PLAN.md`](PLAN.md); semantic and decision rules in
[`CONTRACT.md`](CONTRACT.md); phase details under [`phases/`](phases/); canonical
findings under [`findings/`](findings/); inventory ownership under
[`inventory/`](inventory/); and command proof in
[`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active.
- Current phase: Phase 14 — verification and closeout.
- Active slice: [Phase 14 verification and closeout](phases/phase-14-verification-and-closeout.md).
- Planning audit anchor: `1933c43ff7b4d35b57b0852013d95f3881a8cb28`.
- Compatibility baseline: `71c476e9c86263fe907105b011ca4dde0a619d66`.
- Behavioral sync cursor: `f3f0242fba297d82e0efcc2c31ca1428569b70f2`.
- Toolchain observed at opening: Node `v24.19.0`; pnpm `11.23.0`.
- Opening worktree state: clean.
- Full differential prerequisite: available as a clean detached worktree at
  `/home/codex/risu-baseline-71c476e9c`; its exact commit, dependency state, and
  cleanliness are enforced by `pnpm prepare:compat-baseline` and the harness
  preflight.
- Current compatibility state: Phases 0 through 13 are complete.
  Phase 5 closes settings/default/preset/collection ownership at
  `b34b7a78f28cb5903ece3880073fbb9e46392cb8` and visible character-authoring
  reload evidence at `5eca30f4872e865efee2c86f4dde7ae71e915f9a`.
  Phase 6 closes prompt contributor/action/style ownership and durable
  generation/finalization faults at
  `19ba37af26df7db60d7393976d61b520a785076b`, with exact visible pre-token
  failure/Retry recovery at
  `477a3aece1fffc159b0354fef5b21ecddf60cab5`.
  Phase 7 closes every model format, server adapter, profile/runtime option,
  fixed provider operation, translation lifecycle, image provider, speech
  operation, and transcription path at
  `fe7825f3da4bdd2aceb090fc6eaaa9b2cf5a6050`.
  Phase 8 closes retained memory/embedding selection and complete memory/BardWiki
  queue lifecycles, including a real SQLite close/reopen startup recovery, at
  `a77f47c9f79b0233e147456e73ded69e1869d192`.
  Phase 9 closes CBS, trigger/effect, regex, Lua, execution-bound, and explicit
  unsupported ownership at
  `3963a1278b5f15175c295e3707d25fbf07bdcb56`, with baseline parity restoration
  for malformed `firstmsgindex` and whole-trigger abort handling at
  `08d04efbf6bcc0f64c706bafe454a8649f9971be`.
  Phase 10 closes Plugin V3, module lifecycle/no-port, MCP/OAuth, and specialized
  tool ownership at `e8bbbeea6ad400234aa4d0abad330356265c3c23`, with
  bounded/fail-closed specialized tool corrections at
  `397e06c67694f59d96a087ea1974802e5e0bd4c6`.
  Phase 11 closes portable envelope/block/table, asset/export integrity, staged
  import/restore, salvage, and backup ownership at
  `56287bcb62c1dcdb969a7d185371a1c539bf3200`.
  Phase 12 closes route/auth/writer/stream policy, limits, recovery ordering,
  diagnostics, supported runtime, Web Push, and four individually signed no-port
  products at `1430b714855f4df208a07f54df4653a681a04351` and
  `140c04d24724fcb09cef9ad57fd38bcc976054f6`, with Push boundary
  hardening at `8820b3e8c2cd1452b155b56167c66292e3029cdf`.
  Phase 13 makes register closure executable at
  `473f88478a22ce3bb851e5ab3e1323addd15fbbf`, closes the final historical
  evidence placeholders at `7bf742dd0e8bb37aa6d29fc40c97c4f49fbace5d`,
  and exhausts the upstream sweep at
  `d8d00b60b63f7905ff45de9a9b88aa8814c2d82b`.
  After the independent Phase 2 governance-link correction
  `7ba933fe6f1c3338bd9cce2ef308b2b216ac8e8d`, the required pinned differential
  passes with 16 baseline cells, 18
  current/cluster tests, 15 governed divergences, and healthy cluster 10.
- Phase 4 closes route/control ownership, visible chat lifecycle, and the signed
  shared responsive-shell decision through
  `6487cba00e3cc435a3c4f57f8121663bcdccc57e`.
- Canonical findings: 15 resolved findings with current verification commits:
  14 historical imports with exact raw mappings plus the Phase 1
  lossless-normalizer finding `ORC-A-015`.
- Open maintainer decisions: none. All 71 decisions are signed; individual RH+
  commits reconstruct authority for the four historical boundaries, responsive
  shell, retired character additional-information retrieval, and the six
  Phase 9 parser/runtime differences, and four cohesive Phase 12 no-port
  products.
- Next action: run the exact Phase 14 whole-product manifest, record the final
  verification commit and artifacts, close all four registers, synchronize
  current documentation, and archive the intact workstream.

## Phase Router

| Phase | Status | Outcome |
| ---: | --- | --- |
| [0. Cursors, contract, inventory, and pilot](phases/phase-0-cursors-contract-and-inventory.md) | Complete | Frozen references, exact authority import, fail-closed registers, reproducible baseline, and four verified pilots. |
| [1. Harness and assurance architecture](phases/phase-1-harness-and-assurance-architecture.md) | Complete | Made baselines, fixtures, differential/expected-difference ownership, affected selection, CI, and release gates reproducible. |
| [2. Browser state synchronization and recovery](phases/phase-2-browser-state-sync-and-recovery.md) | Complete | Re-verified bootstrap projections, writer/observer boundaries, outbox/receipts, replay, reconnect, reload, and recovery lineage. |
| [3. Persistence, commands, events, and bridges](phases/phase-3-persistence-commands-events-and-bridges.md) | Complete | Closed command, durable-field, SQLite, event/resource, replay, and editing-bridge ownership. |
| [4. Navigation, chat, shared UI, and presentation](phases/phase-4-navigation-chat-and-shared-ui.md) | Complete | Closed route/control ownership, built-browser generation/recovery/reroll journeys, and the signed shared responsive shell. |
| [5. Settings, profiles, authoring, and catalogs](phases/phase-5-settings-profiles-authoring-and-catalogs.md) | Complete | Closed settings/default/preset and collection ownership, visible character reload, Realm/catalog failure behavior, and upload atomicity. |
| [6. Prompting, generation, and streaming](phases/phase-6-prompting-generation-and-streaming.md) | Complete | Closed model-visible contributor/action/style ownership, durable transcript/fault/finalization semantics, visible retry, and signed unsupported boundaries. |
| [7. Providers, models, translation, and media](phases/phase-7-providers-models-translation-and-media.md) | Complete | Closed format/adapter/profile/option/operation ownership, provider-wire fixtures, persisted translation routing, and media dispatch. |
| [8. Memory, embeddings, jobs, and workers](phases/phase-8-memory-embeddings-jobs-and-workers.md) | Complete | Closed retained-memory/embedding selection, budgets, memory/BardWiki job states, retry/cancel/restart, stale-target, and reconciliation ownership. |
| [9. Scripting, parsing, triggers, and automation](phases/phase-9-scripting-parsing-triggers-and-automation.md) | Complete | Closed CBS/parser parity, individually signed runtime differences, trigger/effect ordering, explicit unsupported effects, regex bounds, and Lua API/failure ownership. |
| [10. Plugins, modules, MCP, and specialized tools](phases/phase-10-plugins-modules-mcp-and-specialized-tools.md) | Complete | Closed Plugin V3 API/permission/runtime ownership, module lifecycle/no-port, MCP/OAuth/egress, and specialized-tool catalogs and failure behavior. |
| [11. Assets, imports, exports, saves, and backups](phases/phase-11-assets-import-export-and-backups.md) | Complete | Closed portable envelopes/blocks/tables, asset reference and stream integrity, staged import/restore/salvage, historical formats, and supported round trips. |
| [12. Runtime, platform, limits, and diagnostics](phases/phase-12-runtime-platform-and-diagnostics.md) | Complete | Closed route policy, shared limits, recovery ordering, diagnostic secrecy, supported runtime/polyfills, Web Push, and four individually signed no-port products. |
| [13. Consolidation, adjudication, and remediation](phases/phase-13-consolidation-adjudication-and-remediation.md) | Complete | Closed historical evidence, made lifecycle closure fail closed, and independently adjudicated all 85 upstream units. |
| [14. Verification and closeout](phases/phase-14-verification-and-closeout.md) | In progress | Prove zero unexplained differences, complete decisions, final quality/release gates, current docs, and archive handoff. |

## Phase 0 Completion Record

- `STRUCTURE.md` records the behavioral sync cursor separately from the Git fork
  point.
- The archived upstream ledger covers `71c476e9c..f3f0242fb` and records that all
  units were dispositioned before the base advanced.
- The baseline object exists in both repositories; a detached clean worktree was
  prepared without moving `/home/codex/Risuai`, and preflight rejects a wrong
  commit, attached branch, dirty tree, or missing dependencies.
- The upstream register contains all 85 first-parent units in exact Git order,
  with historical disposition kept separate from current verification.
- The registers contain 77 initial surfaces, 59 historical decisions (55 signed
  and four authority-pending), 14 resolved findings, and all 75 historical raw
  reports mapped exactly once.
- The four pilots are verified by production-path tests for preset field
  completeness, persisted translation dispatch, Responses request ownership,
  and portable reroll candidates through all supported `.risu` codecs.

## Phase 1 Completion Record

- The pinned baseline, shared 16-cell schema, semantic normalizer, fixture and
  golden manifests, and decision-backed expected-difference registry fail
  closed at `546ea5aaee78144176043971fdd2c13c9e7c6079`, including explicit fixture-source
  classifications.
- The inactive-generation-metadata mismatch was corrected at its production
  owner in `c33dac56811c3c6c6bdf72f8ad3faac796abfe59`; normalization did not hide it.
- Prompt-preview diagnostics were kept distinct from persisted transcript
  metadata in the follow-up `5b6a9d492beb399a58d9695097171a9c3edf1b4d`.
- Affected and aggregate selection own register validation, current-only
  compatibility, and required full-pinned selection at
  `6ddc82431230ee40cf9c4151d3388baab0162998`.
- Main quality CI, daily/manual pinned cadence, artifact retention, and
  release-equivalent evidence ownership are recorded at
  `328a70787c26051525a713fc86311fe672dd7b8b`.
- Category A inventory rows `ORC-SURFACE-078` through `ORC-SURFACE-085` own the
  eight assurance surfaces and their exact implementation and test evidence.

## Phase 2 Completion Record

- Shared projection normalization across shell, full-settings, cache, and group
  reads, legacy `pip` migration, selection repair, and lineage-preserving
  response/SSE parsing landed at
  `3ce85c1f034b3afc493e291f8a8f5e9227064463`.
- The audit caught a valid partial-object fallback regression in that change;
  `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74` preserves persisted partial values
  while still defaulting invalid shell fields.
- Durable writer, observer, outbox, receipt, replay, response-loss, reconnect,
  takeover, and reload owners were re-verified through focused and built-browser
  evidence.
- Category B rows `ORC-SURFACE-086` through `ORC-SURFACE-088` own the new
  assurance surfaces; historical rows `ORC-SURFACE-023` and `ORC-SURFACE-072`
  are verified with no residual.

## Phase 3 Completion Record

- `958f8585138ec817fe5d134563df585434ed5821` pins all 161 command routes, 422
  retained Database fields, 46 SQLite tables and exact columns, 146 command
  events, browser resource reconciliation, replay ordering, and six built-in
  durable editing bridges.
- The same change restored six retained legacy-memory settings to the writable
  command catalog and represented both retained auto-continue interchange fields
  in the current Database type.
- `3f20a80b780f2538fd1e38aa6514d9a9f894985a` accepts only exact BardWiki
  preview/dry-run eventless receipts while keeping mutating receipts event-bound.
- Category C rows `ORC-SURFACE-089` through `ORC-SURFACE-093` own the new
  structural surfaces; historical rows `ORC-SURFACE-024`, `ORC-SURFACE-025`,
  `ORC-SURFACE-061`, and `ORC-SURFACE-073` are verified.
- Focused production, structural, browser event, and recovery lanes passed at
  `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`, followed by the required full
  pinned differential. The canonical inventory now contains 93 rows.

## Phase 5 Completion Record

- `b34b7a78f28cb5903ece3880073fbb9e46392cb8` closes all 422 retained
  `Database` fields across settings/collection/character/dedicated/preset and
  opaque-round-trip owners, exact browser/Fastify readable and writable groups,
  preset-field catalogs, retained defaults, and legacy/no-control settings.
- All eleven repository collection kinds have a reviewed command prefix,
  SQLite table, and deeper domain owner. Category E owns their authoring surface;
  runtime and interchange remain explicitly cross-owned by Phases 6-11.
- `5eca30f4872e865efee2c86f4dde7ae71e915f9a` proves through the visible built
  browser editor and real Fastify `PATCH` that character name, description,
  first message, and stable identity survive full reload.
- Realm catalog failure/empty/stale/confirmation behavior, atomic JSON/CharX
  acquisition, bounded/idempotent uploads, staged-byte cleanup, and separately
  revisioned inlay-catalog behavior were re-verified in the complete server lane
  and focused browser-owner tests.
- New verified Category E rows `ORC-SURFACE-094` through `ORC-SURFACE-096` own
  these surfaces; pilot row `ORC-SURFACE-001` is re-verified. No new finding or
  decision was required, and the inventory now contains 96 rows.
- Signed character/module conversion `ORC-DECISION-058` remains Category J
  Phase 10 verification work. Phase 4's separately signed responsive-shell
  decision does not alter this Phase 5 evidence.

## Phase 4 Completion Record

- `e9901b0f68acc405cef8a8af642eb40f83e8affb` closes every route family and
  stable primary control marker across route, sidebar, chat, message,
  generation, input-hook, translation, speech, export, and local owners.
- The focused route/App/sidebar/composer/reroll/hotkey selection passes all 156
  tests. The production-bundle accepted-send matrix passes all eleven desktop
  and Pixel journeys; the reload/swipe reroll journey also passes.
- `477a3aece1fffc159b0354fef5b21ecddf60cab5` proves the visible pre-token
  provider error and exact billing-aware Retry without duplicating the accepted
  user row.
- RH+ commit `2073b5fb6a755516b80e48509c6e0a322f062677` explicitly establishes the
  mounted shared App shell as the current responsive product contract in place
  of the baseline's unmounted beta-mobile components. `ORC-DECISION-060` and
  `ORC-SURFACE-099` govern the signed difference.
- Category D rows `ORC-SURFACE-097` through `ORC-SURFACE-099` own the closed
  surfaces. The inventory now contains 99 rows and all 60 decisions are signed.

## Phase 6 Completion Record

- `19ba37af26df7db60d7393976d61b520a785076b` closes nine prompt assembly
  stages, every retained model-visible contributor, five actions, nine styles,
  twelve durable operation states, five finalization projections, seven effect
  kinds, and thirteen stream events against production owners.
- The same anchor adds focused durable regressions proving that an extend-style
  streamed Continue cancellation persists its partial on the original assistant
  and that deletion of an admitted continue/regenerate target cannot recreate
  or mis-target a row during finalization.
- `477a3aece1fffc159b0354fef5b21ecddf60cab5` proves the built-browser pre-token
  failure/Retry outcome: one accepted user row, a visible billing confirmation,
  and exactly two provider attempts across the failed attempt and retry.
- Category F rows `ORC-SURFACE-100` through `ORC-SURFACE-102` own closed prompt,
  durable lifecycle, and retired additional-information surfaces. All 25
  historical Category F decision/finding rows, including group no-port row
  `ORC-SURFACE-009`, are independently re-verified; no Category F row remains
  mapped-only.
- RH+ commit `ec124302cbe49e718228322ca22b32a2ddf74d6e` signs
  `ORC-DECISION-061`: imported `Character.additionalText` remains preserved and
  visibly read-only while prompt omission is pinned. The inventory now contains
  102 rows, including 28 verified Category F rows, and all 61 decisions are
  signed.
- Focused server/group/additional-information owners, the 16-cell pinned
  differential, server typechecks, registers, formatting, and diff checks pass.

## Phase 7 Completion Record

- `fe7825f3da4bdd2aceb090fc6eaaa9b2cf5a6050` closes all 24 retained model
  formats over 15 admitted server text adapters or explicit browser-only paths,
  plus nine first-class provider profiles and every provider/runtime option.
- The same closed-world gate binds all 18 fixed provider operations, four raw
  translator kinds and five translation lifecycle owners, eight image
  providers, five speech operations, and the fixed Whisper VTT transcription
  path to production and behavioral assurance.
- Sanitized request-capture suites retain endpoint, headers, credentials, roles,
  model, options, streaming, fallback, cancellation, and failure semantics
  without paid live calls. A built-browser journey independently proves
  per-chat translator-preset persistence.
- Category G rows `ORC-SURFACE-103` through `ORC-SURFACE-105` own the new closed
  matrices. All 13 historical mapped-only Category G rows are independently
  re-verified; Category G is 18/18 verified and the total inventory is 105.
- Signed `ORC-DECISION-006` and `ORC-DECISION-059` continue to govern the
  browser-only provider and curated-catalog boundaries. No new finding or
  decision was required.
- Focused server/browser provider, translation, speech, and media suites,
  server typechecks, the visible translator-preset browser journey, registers,
  formatting, and diff checks pass.

## Phase 8 Completion Record

- `a77f47c9f79b0233e147456e73ded69e1869d192` closes the standard Hypa planner,
  five retired algorithms, 18 embedding aliases, four allocation categories,
  three BardWiki modes, and nine score reasons over explicit owners.
- The same structural gate closes every memory/BardWiki job kind, all five
  queue states, terminal states, retry/exhaustion, cancellation, duplicate
  delivery, restart recovery, stale invalidation/reconciliation, and terminal
  diagnostic owner. Reserved `chunk` is explicitly no-op because assembly owns
  live planning.
- A real SQLite close/reopen plus Fastify-start regression proves an abandoned
  running job is recovered, executed once, and remains durably completed with
  attempt count 2 after another reopen. Invalid-ratio diagnostics and
  conventional empty-flag lore regex parsing are also pinned.
- Category H rows `ORC-SURFACE-106` through `ORC-SURFACE-108` own the new closed
  surfaces. Historical rows `ORC-SURFACE-035` and `ORC-SURFACE-058` through
  `ORC-SURFACE-060` are independently re-verified; Category H is 7/7 verified
  and the total inventory is 108.
- Decision-owner records for `ORC-DECISION-031` and `ORC-DECISION-054` through
  `056` now point to the actual lorebook, memory-adapter/planner, allocator,
  assembly, and worker regressions. No new decision or production fix was
  needed.
- The 563-test owning lane, persistence/generation integration, retired-memory
  browser assurance, server typechecks, registers, formatting, and diff checks
  pass.

## Phase 9 Completion Record

- `3963a1278b5f15175c295e3707d25fbf07bdcb56` closes all 176 CBS
  registrations, 151 executable callbacks, 245 normalized matcher names, 118
  trigger effects, six modes, four condition kinds, four regex stages, and 54
  Lua host APIs over their browser/Fastify owners.
- `08d04efbf6bcc0f64c706bafe454a8649f9971be` restores literal
  `{{firstmsgindex}}` fallback when malformed chat data omits `fmIndex` and
  retains whole-trigger abort semantics without leaking transient output or
  losing prior durable variable writes.
- Exact baseline/browser/Fastify fixtures expose rather than normalize group
  retirement, history windows, reverse, runtime metadata, standalone slots,
  each expansion bounds, missing callback data, and Lua failure behavior.
- `ORC-DECISION-062` through `ORC-DECISION-067` reconstruct individual RH+
  authority for the six retained differences; existing group no-port
  `ORC-DECISION-005` now also owns the retired group-aware parser branch.
- Category I rows `ORC-SURFACE-109` through `ORC-SURFACE-117` own the new
  surfaces. All nine historical Category I rows are independently re-verified;
  Category I is 18/18 verified, the inventory has 117 rows, and all 67
  decisions are signed.
- The 359-test Fastify lane, shared browser corpus, 29-test pinned baseline,
  current differential, register gates, browser/server checks, formatting, and
  diff checks pass.

## Phase 10 Completion Record

- `e8bbbeea6ad400234aa4d0abad330356265c3c23` closes the 85-key
  Plugin V3 API, nine permissions, four runtime phases, seven RPC types, exact
  module activation/lifecycle owners, four MCP identifier classes, six internal
  clients, OAuth refresh/DNS-pinned egress, and every specialized/Risu-access
  tool catalog.
- `397e06c67694f59d96a087ea1974802e5e0bd4c6` makes Dice bounded and
  fail-closed, validates/bounds GraphMem without overwriting malformed durable
  state, and replaces an unadvertised file-system recovery instruction.
- Historical character/module interchangeability row `ORC-SURFACE-062` is
  independently re-verified at its actual module picker/editor owners and
  remains governed by signed `ORC-DECISION-058`.
- Category J rows `ORC-SURFACE-118` through `ORC-SURFACE-121` own Plugin V3,
  module, MCP/OAuth, and specialized-tool surfaces. Category J is 5/5 verified
  and the total inventory is 121 rows.
- The 426-test browser lane, 308-test Fastify lane, specialized regressions,
  server/browser checks, registers, formatting, and diff checks pass.

## Phase 11 Completion Record

- `56287bcb62c1dcdb969a7d185371a1c539bf3200` closes all four
  supported `.risu` envelopes, every portable block type, every declarative and
  specialized asset owner, and every live SQLite table over an explicit
  import/export/backup disposition.
- Export preflights asset size/SHA before starting a response and verifies bytes
  again while streaming. Corruption fails before headers; post-preflight
  mutation aborts ZIP and legacy streams instead of producing a successful
  corrupt artifact.
- Import bounds database bytes, entry count/names, legacy records, duplicates,
  envelope/version/hash data, writer/auth state, and disconnects. Staging
  failure rolls back new bytes without removing deduplicated live assets or
  replacing the database; successful restore creates a safety snapshot and
  reopens fresh state.
- Category K rows `ORC-SURFACE-122` through `ORC-SURFACE-124` own the new
  closed surfaces. All nine historical mapped Category K rows are re-verified
  alongside pilot `ORC-SURFACE-004`; Category K is 13/13 verified and the total
  inventory is 124 rows.
- The 112-test owning lane, server checks, registers, formatting, and diff checks
  pass. The pinned Original harness's lack of an executable reroll save exchange
  remains the exact explicit pilot residual.

## Phase 12 Completion Record

- `1430b714855f4df208a07f54df4653a681a04351` closes route
  method/path/auth/writer/stream policies, 15 route rate limits, shared
  size/count/time/concurrency bounds, startup/readiness/recovery/shutdown order,
  diagnostic redaction/retention, nine baseline runtime features, and Web Push
  lifecycle ownership.
- `8820b3e8c2cd1452b155b56167c66292e3029cdf` authenticates Push
  mutation before bounded parsing, validates bounded HTTPS-only subscription
  fields, applies a 10-second delivery timeout, and proves persisted session,
  VAPID, and subscription state after reopen.
- `140c04d24724fcb09cef9ad57fd38bcc976054f6` pins absent wrapper,
  PeerJS room, Account/Drive cloud-sync, and browser-local authoritative runtime
  surfaces while retaining their explicitly excluded supported web/server
  neighbors.
- `ORC-DECISION-068` through `ORC-DECISION-071` reconstruct individual RH+
  authority for those four cohesive no-port products; no umbrella guidance is
  promoted into a decision.
- Category L rows `ORC-SURFACE-125` through `ORC-SURFACE-134` own the closed
  surfaces. Category L is 10/10 verified, the inventory has 134 rows, and all 71
  decisions are signed.
- The focused/expanded Fastify and browser lanes, server/browser checks,
  registers, formatting, and diff checks pass.

## Phase 13 Completion Record

- `473f88478a22ce3bb851e5ab3e1323addd15fbbf` adds coherent lifecycle state to
  all four registers and rejects any declared closure with unfinished rows,
  proposed decisions, stale finding placeholders, or upstream units without
  current evidence.
- `7bf742dd0e8bb37aa6d29fc40c97c4f49fbace5d` re-verifies the last six mapped
  Category D rows at direct reroll, multisend, Stop, concurrency, Continue, and
  stopped-partial owners, and refreshes all 14 historical findings at their
  completed domain anchors. All 134 inventory rows are verified and all 15
  findings are resolved with current regression evidence.
- `50b24164f06c93b425c65ae14dad034c1af01715` records the component-wise
  upstream adjudication and exact Phase 14 manifest;
  `d8d00b60b63f7905ff45de9a9b88aa8814c2d82b` publishes 47 verified and 38
  currently not-applicable upstream units with no pending state or empty
  evidence.
- No new incompatibility, duplicate finding, orphan raw report, proposed
  decision, or unsigned expected difference was found. All 71 decisions remain
  signed and all 75 raw reports remain mapped exactly once.
- The focused Category D browser lane passes 7 files/185 tests; the complete
  Fastify lane passes 178 files/3,648 tests with one skip; the focused upstream
  browser-owner lane passes 25 files/677 tests; affected selection, the
  13-test fail-closed register suite, schema validation, formatting, and diff
  checks pass.

## Locked Planning Decisions

- The fork point and behavioral sync cursor remain separate authorities.
- Upstream disposition and Fastify behavioral verification remain separate
  inventory fields.
- User-visible compatibility wins by default; exceptions require individual
  authority.
- Physical Fastify architecture may differ when observable behavior remains
  compatible.
- Unsupported/no-port behavior must be absent, explicit, or visibly diagnosed;
  silent partial behavior is not accepted.
- The workstream uses the current project taxonomy and `PLAN.md` + `status.md` +
  phase-file structure.
- Closure requires the pinned full differential; current-only goldens cannot
  substitute for baseline proof.
- No phase closes with unowned pending rows or unsigned expected differences.

## Maintenance Rules

- This file is the only live phase/slice router.
- Update it whenever a slice changes state, a finding is confirmed, a decision is
  signed, a blocker changes, or validation runs.
- Record the current Fastify verification commit for every completed domain
  phase; do not imply that the planning anchor covers later implementation.
- Keep durable rules in `PLAN.md`/`CONTRACT.md` and detailed evidence in the
  owning phase, inventory, finding, or verification file.
- Do not mark a phase complete while tests fail, a required baseline is absent,
  or a correctness gap lacks an explicit owner and revisit condition.
