# Maintainability and Performance Status

Updated: 2026-09-05

## Execution Cursor

- State: Phases 0–3 accepted; implementing Phase 4 server maintenance scheduling.
- Opening source: `2a1abfbf937895d598b92dfd3724ef6a501dd7fd`.
- Execution source: `2d9290bfc` (opening implementation plus plan), clean at task start.
- Next phase: [4. Server maintenance scheduling](phases/phase-4-server-maintenance.md).
- Next task: finish backup ownership/consistency verification, then share bounded
  reference discovery between backup verification and asynchronous asset GC.
- Blockers: none.
- Implementation commit: `491cc1820` fixes F01. Phase 1 probe commits and
  acceptance evidence and completed Phase 2 slices are recorded below.

Read [PLAN.md](PLAN.md) for stable scope, evidence, and invariants; read only the
selected [phase](phases/README.md) for implementation detail.

## Phase Router

| Phase | Findings | State | Accepted implementation/evidence |
| --- | --- | --- | --- |
| [0. Character creation safety](phases/phase-0-character-creation-safety.md) | F01 | Accepted | Targeted append; 18 HTTP preservation/replay/rollback cases |
| [1. Baselines and budgets](phases/phase-1-baselines-and-budgets.md) | F02–F10 | Accepted | [Baselines and numeric budgets](evidence/baselines.md) |
| [2. Browser work](phases/phase-2-browser-work.md) | F03, F05, F04, F06 | Accepted | Scoped rollback, single normalization, background cache, selected locale |
| [3. Generation inputs and types](phases/phase-3-generation-inputs-and-types.md) | F02, F09 | Accepted | [Selected inputs, concrete contracts and final costs](evidence/generation-inputs.md) |
| [4. Server maintenance](phases/phase-4-server-maintenance.md) | F07 | Executing 4b | Backup ownership/copy slice implemented; bounded reference discovery and GC next |
| [5. Transcript residency](phases/phase-5-transcript-residency.md) | F08 | Pending Phase 4; implementation decision open | None |
| [6. Shared policy and closeout](phases/phase-6-shared-policy-and-closeout.md) | F10; all closeout evidence | Pending prior phases | None |

## Finding Dispositions

| Finding | Disposition | Missing completion evidence |
| --- | --- | --- |
| F01 | Fixed; targeted creation and Agent Preset deletion cleanup preserve dependent rows | Final combined aggregate pending |
| F02 | Fixed within recorded configuration-row/legacy exceptions; selected reads and bounded query programs | Final combined aggregate pending |
| F03 | Fixed; scoped metadata and organization captures | Final combined aggregate pending |
| F04 | Fixed; bounded background writes/pruning and lifecycle fences | Final combined aggregate pending |
| F05 | Fixed; one owned normalization per staged/replaced intent | Final combined aggregate pending |
| F06 | Fixed; selected loading, readiness and real-browser chunk retry | Final combined aggregate pending |
| F07 | Open; backup copy/ownership implemented | Shared bounded reference scan, safe asynchronous GC and final stall comparison |
| F08 | Open; large baseline exceeds heap/page-layout budgets | Recorded implementation/retention decision and after evidence |
| F09 | Fixed; finite checked views and explicit mutable ownership | Final combined aggregate pending |
| F10 | Open; source-confirmed duplication | Shared owner and unchanged consumer behavior |

## Verification Ledger

Distinguish audit observations, documentation checks, and implementation gates.
Do not carry an opening pass forward as proof of a later implementation commit.

| Scope | Source/date | Evidence | Limitation |
| --- | --- | --- | --- |
| Opening audit | Opening source, 2026-09-05 | Eight research areas cross-checked against source; both character creation endpoints reproduced BardWiki deletion in disposable SQLite fixtures. | Temporary reproductions are not checked-in regression tests; no production data inspected. |
| Opening preload | Opening source, 2026-09-05 | `pnpm build:initial-preload` passed; 389,721 total gzip bytes, 291,801 language gzip bytes. | Build sizes are not browser latency measurements or total post-startup transfer. |
| Plan review | Current documentation worktree, 2026-09-05 | Two read-only reviews completed; clarified cache-generation fences, nested prompt types, backup pins, and full-transcript screenshot exceptions. | Review of proposed work; no implementation evidence. |
| Plan documents | Opening source plus plan documents, 2026-09-05 | Explicit link/path validation passed for all 11 plan/index documents; `pnpm check:docs` passed for 49 current documents; whitespace checks passed. | Does not close implementation findings. |
| Agent aggregate | Opening source plus plan documents, 2026-09-05 | `pnpm test:agent` passed in 2m 16s: server/browser-smoke types, topology, current docs, frontend tests/check, server tests, and smoke build. | Excludes Playwright, specialized performance, and user/CI compatibility lanes; the new F01 regression is still future work. |

For each implemented slice add its source commit, fixture/reproduction, exact
commands and results, before/after cost, changed contract if any, and residual
risk. If evidence fails, record the failure and next action instead of advancing
the phase. Keep long generated logs outside this document; preserve the facts
needed to reproduce them here or in the owning phase's bounded slice record.

## Decisions and Exceptions

- The ten audited findings remain the scope. F02–F06 and F09 are fixed with the
  explicit F02 configuration/legacy exceptions below. F01 creation is fixed and
  its confirmed deletion follow-up is fixed; F07, F08 and F10 retain their
  implementation/decision gates. No finding is silently deferred or added.
- Phase 0 precedes broad benchmarking because F01 is a reproduced correctness
  failure. Performance measurement must not delay its repair.
- F08 retains an implementation decision gate. A measured decision to keep
  paging must record its supported fixture envelope and revisit trigger.
- The single-writer model, durable outbox, revision/event ordering, and existing
  shared-package boundaries remain invariants, not optimization targets.

- 2026-09-05, F08 product amendment: the user's commit `4e90ff094` accepts
  full-transcript native browser find being unavailable for unmounted messages
  and limits cross-message drag selection/copy. Phase 5 still preserves mounted
  message selection, per-message copy, in-app search, jumps, export, and
  temporary full-transcript screenshots. The phase document is authoritative
  for this accepted constraint change.

- 2026-09-05, sequencing amendment for F02/F07: Phase 3's finite types,
  structural scope and behavior gates pass (181 chat, 69 durable, 18 loader and
  11 browser cases); only the small timing comparison remains open. Phase 4a
  backup implementation may proceed under a separate owner while that bounded
  timing issue is resolved. Backup edits own repository maintenance/lifecycle;
  validator edits own generated validation artifacts. No shared-file edits or
  concurrent performance runs are allowed. Phase 4 acceptance and all later
  phase gates still require Phase 3 timing accepted; this is no finding deferral
  or budget change. Revisit sequencing if either owner exposes a dependency.

- 2026-09-05, F02 retained-cost amendment: ordinary selection excludes unrelated
  character/chat bodies, extracted collection bodies and assets. The existing
  global configuration JSON row still parses embedded profiles/credentials and
  Agent records before selection; legacy embedded-character storage keeps a
  named compatibility read. [Separate measurements](evidence/generation-inputs.md)
  expose both costs, while original ordinary-path budgets are unchanged and pass.
  These are retained architectural exceptions, not new caches or a deferred
  ordinary-reader cutover. Splitting authoritative configuration would require
  coordinated mutation/import/credential-repair migration beyond this input
  change. Repository/settings ownership retains that work; revisit when the
  339,610-byte configuration fixture exceeds the original large 1.066/2.812 ms
  preparation budgets, or when those collections move out of the settings row.
  Remove the legacy exception when pre-extraction input support is retired.

- 2026-09-05, F01 correctness follow-up: the remaining ordinary
  `deleteAgentPresetCommand` broad writer was reproduced at `2e2c321e9` in a
  dedicated disposable HTTP fixture. DELETE returns 200 with correct selection
  cleanup, but both affected and unaffected chats lose BardWiki settings,
  documents, versions, search and links (each family 2 to 0). Scope now includes
  targeted settings/affected-chat cleanup for this caller under F01; intentional
  import/restore replacement writers remain separate. The dedicated regression
  must pass preservation, rollback and replay before closeout. No performance
  budget changes or new finding IDs are introduced.

Future amendments belong here with date, affected finding, evidence, owner,
residual cost, and revisit condition. If an amendment changes stable scope or
phase dependencies, update `PLAN.md` and the affected phase at the same time.

## Phase 0 Accepted Evidence

- Source cross-check: both normal creation routes still invoke the broad
  message-free writer at the execution anchor. Six independent read-only Luna
  research areas were checked against live source; production edits remain
  sequential by owner.
- Foreign-key inventory: `chats` and `greeting_translations` cascade from
  `characters`. BardWiki settings/documents/receipts/jobs/search cascade from
  `chats`; versions, sources, links, manifests, and staging depend on those
  BardWiki rows. Messages and `chat_hypa_v3` are logical chat dependents without
  chat foreign keys. Preservation assertions must cover all of them directly.
- The new append path reads settings and an identity/trash-status projection
  for order validation, performs keyed duplicate checks, and inserts only the new
  character and optional empty chat. Existing single-writer transaction, receipt,
  revision, event, and post-commit emission boundaries are reused.
- Broad-writer inventory: after the creation cutover, ordinary
  `deleteAgentPresetCommand` remains a message-free caller; generic hydrated
  mutation and import/restore replacement helpers also retain broad writers.
  This is evidence of remaining cost/risk, not an implemented remedy. Phase 0
  does not widen into those owners; audit further at closeout before any scope
  decision. Import/restore replacement semantics remain intentional.
- Workflow interpretation: the current `AGENTS.md` and test guide require the
  aggregate only after all implementation work is complete. Phase-level checks
  therefore use exact focused tests; `pnpm test:agent` is the final combined gate.

- Durable reproduction: `characterCreationSafety.test.ts` failed on each opening
  route after HTTP 200: two existing BardWiki manifests became zero. The fixture
  seeds two characters/chats, four messages, two Hypa rows, greeting translations,
  all ten BardWiki families including resolved links/search, split collections,
  plugin storage, and a prior command receipt. SQL audit triggers detect physical
  rewrites even when rowids are reused. Both routes now preserve every old row.
- Explicit domain-table budget: 16 broad table families before; exactly
  `characters` + `settings` after, adding `chats` only for an initial chat. Normal
  revision/event/receipt infrastructure is asserted separately. Replay writes
  nothing and emits nothing; injected chat/event/receipt failures roll back all
  rows, revision, and audit triggers.
- The replay fixture exposed request normalization before receipt fingerprinting.
  Both routes now capture the submitted-intent fingerprint before normalization,
  including generated global-lore defaults and selection timestamps.
- Focused verification: `pnpm test --` followed by each of
  `server/fastify/__tests__/characterCreationSafety.test.ts` (18 passed),
  `server/fastify/__tests__/commands.test.ts` (241 passed),
  `server/fastify/__tests__/commandMutationReceipts.test.ts` (12 passed),
  `server/fastify/__tests__/commandSingleRowPaths.test.ts` (21 passed), and
  `server/fastify/__tests__/bardWikiLifecycle.test.ts` (8 passed).
  `pnpm check:docs` passed (49 current documents); explicit
  `validateCurrentDocumentation` with all ten workstream documents,
  `indexSpecs: []`, and `literalPathExemptions: []` passed. Prettier and
  whitespace checks passed. Final aggregate/browser/performance evidence is
  still pending, and these correctness tests make no latency claim.
- Residual cost: order validation visits existing character identities and
  extracts identity/trash status with SQLite JSON expressions; it does not
  materialize unrelated bodies in JavaScript. Legacy embedded-character state
  is rejected for explicit import/recovery rather than shadowed by an append.
  This prevents future deletion; recovery of historical production loss remains
  outside this local change.

## Phase 1 Accepted Evidence

- Browser structural probes and budgets: `f1fa4753b`,
  [F03/F04/F05 baseline](evidence/browser-work-baseline.md). Twelve focused
  cases pass; fixed-folder snapshot grows to 9,916,585 bytes, mutable outbox
  bodies normalize twice, and ten resource reads cause ten prune passes.
- Generation preparation/type inventory: `c5f58918f`,
  [F02/F09 baseline](evidence/generation-baseline.md). Two focused cases and the
  opt-in isolated timing run pass. Fixed target history with 48 unrelated owners
  loads 1,049,413 database bytes and 826 SQL result rows per preparation pass.
- Server maintenance: `dfb2d4db1`,
  [F07 baseline](evidence/maintenance-baseline.md). Isolated 20/200/2,000-asset
  matrix passes; zero API/heartbeat progress during GC or post-snapshot backup
  copying. Three measured repetitions plus one warmup per size are retained.
- Locale startup: `c25343989`, [F06 baseline](evidence/locale-baseline.md).
  Production initial preload repeats 389,721 gzip bytes; all twelve English/
  Korean cold/refresh cases show the requested first composer label and reach
  background readiness. Browser trace/readiness and production closure evidence
  remain separate. Repeated script closure lists are being deduplicated in the
  retained evidence without discarding individual timings or transfer totals.
- F10 source digests match and its four policy ownership/behavior tests pass.
- F08 probe: `c4cbb74ec`; [accepted isolated matrix and decision rule](evidence/transcript-baseline.md).
  All ten cases pass in 6.7 minutes. Corrected synthetic image bytes and excluded
  expensive trace recording before measurement. The nine profile/size cases use
  one journey each, 48-frame scroll samples and repeated 15-row page loads;
  screenshot capture/restoration is separate. Full cost matrix is opt-in.
- The large transcript fixtures pass scroll budgets but exceed the chosen
  incremental-page layout and post-GC heap comparison budgets. Deep jumps also
  issue 570 display-source requests; their full wall time cannot be attributed
  to DOM layout. F08's implementation/retention decision remains Phase 5 work.
- F06 retained script paths are deduplicated without changing individual
  milestone, first-label, gzip, encoded-body, or transfer measurements.
- Standard current-document and explicit workstream link/path validation passed.
  All phase-specific focused/browser/performance evidence is recorded in its
  owner. The final combined `pnpm test:agent` remains pending until implementation
  is complete, as required by current project guidance. User/CI compatibility
  and `pnpm test:all` have not been run or implied by these passes.

## Phase 2a: Metadata Capture Accepted; Organization Next

- Implementation: `1dff5c13f`. `captureChatMetadataPatch` / `captureChatFolderMetadataPatch`
  capture only allowed supplied fields plus stable owner IDs. Direct outcome
  dispatchers reuse durable pending-attempt/rebase and projection fencing.
- Live callers migrated: sidebar fold/color/folder rename/chat rename and compact
  chat-list rename. The folder-rename path also checks writer loss before
  changing its local projection, preserving the unsaved draft.
- [After counters](evidence/sidebar-metadata-after.json): exactly 126 snapshot
  bytes at all three Phase 1 fixtures (before: 1,808 / 249,264 / 9,916,585).
  Zero character rows or messages; two scalar copies, largest five bytes.
  The existing one-scalar rollback cost and unrelated message identity survive.
- Focused tests: `pnpm test -- src/ts/chatCommands.test.ts` (195 passed),
  `pnpm test -- src/lib/SideBars/SideChatList.svelte.test.ts` (67),
  `pnpm test -- src/lib/Others/ChatList.svelte.test.ts` (25), and
  `pnpm test -- src/ts/chatCommands.workCosts.dom.test.ts` (3). Cases hold
  overlapping requests, fail older/newer operations, preserve background message
  identities, handle writer loss after capture, and settle queued work after
  authoritative refresh as accepted or failed. UI tests assert no broad capture.
- Current navigation/recovery guides updated; `pnpm check:docs`, Prettier and
  whitespace checks pass. These structural measurements make no latency claim.
- [Remaining caller inventory](evidence/sidebar-snapshot-inventory.md) covers
  create/delete/reorder/folder organization, branch/fork, reset and import.
  F03 stays open until their capture scopes are narrowed and verified. Required
  removed/attempted transcript ownership must remain explicit and bounded by
  the operation's affected rows.

## Phase 2a: Organization Capture Accepted (F03 Closed)

- Implementation: `4964b4cbc`; metadata precursor
  is `1dff5c13f`. Eight distinct typed captures now serve every live sidebar,
  compact list, branch and import caller. The legacy full-state declaration
  remains solely for compatibility inputs/tests; no live caller invokes it.
- Scoped reorder/fork also bypass old optimistic whole-chat-list cloning,
  preserving surviving chat/folder/message identities. Delete/reset retain only
  removed row references so detached message/note edits survive failed rollback;
  capture-time epochs fence authoritative replacements across awaited flushing.
- [Supplemental before](evidence/sidebar-organization-before.json) and
  [after](evidence/sidebar-organization-after.json) use fixed two-chat structure
  with a growing surviving sibling and unrelated histories: broad capture
  10,524 / 291,740 / 10,365,561 bytes. New create/folder-create/folder-delete/
  order/import representations are 326/234/257/298/196 bytes at all sizes.
  Target delete is 958 bytes (two required messages, zero capture copies), fork
  1,501 bytes (two new messages); reset retains only its removed owner's chats,
  up to 313,842 representation bytes/1,002 messages, with zero capture copies.
  These representation sizes are not heap-allocation claims for retained rows.
- The additional fixture is a Phase 1 budget cross-check before the organization
  cutover: fixed captures and maximum copied payloads stay under 4 KiB; reset is
  bounded by required owner chats plus 2 KiB metadata. Zero unrelated bodies are
  retained/copied; an unreadable existing import transcript proves no hidden
  serialization. Required new/removed transcript ownership remains explicit.
- Focused verification: `pnpm test -- src/ts/chatCommands.test.ts` (223 passed),
  `pnpm test -- src/lib/SideBars/SideChatList.svelte.test.ts` (67),
  `pnpm test -- src/lib/Others/ChatList.svelte.test.ts` (26),
  `pnpm test -- src/lib/ChatScreens/Chat.customHtml.test.ts` (60),
  `pnpm test -- src/ts/characters.importChat.test.ts` (21), metadata cost probe
  (3), and `pnpm test -- src/ts/chatOrganization.workCosts.dom.test.ts`
  (25 passed, three baseline-only cases skipped). Legacy baseline mode separately
  passed three cases. Added guards keep the four live entrypoints off broad
  capture; tests cover both legacy and scoped structural semantics.
- Navigation/recovery guides updated; standard and explicit plan documentation,
  Prettier and whitespace checks pass. F03 meets its structural budget; no
  latency claim is made. New/forked transcripts and rollback restoration of
  removed rows retain their necessary operation-owned work.

- Final review reproduced a deletion-selection race during awaited note flushing:
  after selecting surviving chat C, failed deletion restored old chat A. Scoped
  deletion now predicts/binds its selection effect at capture/optimistic write
  and freezes scalar ownership before awaiting. Both helper and direct-projection
  regressions pass; core 223, sidebar 67 and compact-list 26 were rerun.

## Phase 2b: Single Outbox Normalization Accepted

- Implementation: `9690cd25d`. Public staging and
  exact replacement capture external intent once. A private continuation derives
  projection targets and stages any required successor from that owned snapshot;
  the public target helper still validates external input. No storage format or
  receipt/replay ordering changes.
- [After counters](evidence/outbox-normalization-after.json): mutable body copies
  drop from 2/16/2 to 1/8/1, and processed bytes from
  306/131,472/33,552,434 to 153/65,736/16,776,217. Recursively frozen JSON bodies
  still need zero copies. The one encrypted-envelope serialization remains
  244/66,205/16,776,308 bytes; transport serialization is outside this fixture.
- Removing the redundant validation pass exposed JSON conversion that introduces
  an invalid body shape or persisted base revision. The owned JSON result is now
  checked before any staging effects. Tests also cover mutable caller edits,
  request-list mutation during conversion, sparse requests, frozen non-JSON
  canonicalization, cycles/BigInt, request/payload limits, public-helper validation,
  exact placeholder correction and dispatch-race successor ownership.
- Focused verification: `pnpm test -- src/ts/server/pendingMutationOutbox.test.ts`
  (247 passed), `pnpm test -- src/ts/server/pendingMutationOutbox.crossTab.test.ts`
  (6), and `pnpm test -- src/ts/server/pendingMutationOutbox.workCosts.svelte-node.test.ts`
  (6). Exact replacement retains its undispatched receipt; ordinary restaging
  and dispatched predecessors retain fresh-successor and drain semantics.
- Current recovery guide updated. Prettier, whitespace, current-document and
  explicit plan link/path checks pass. These counters meet F05's structural
  budget and make no latency claim; encryption and required body ownership remain.

## Phase 2c: Background Cache Maintenance Accepted

- Implementation: `6b9b632f9`.
  [Ownership, numeric bounds, lifecycle and verification record](evidence/cache-maintenance.md)
  includes structural counters and retained built-browser journeys.
- Cold/warm/eight-read scenarios now perform 4/3/3 prunes versus ten before;
  each isolated eight-read burst performs one prune at every cache size. Valid
  responses resolve while actual pruning is held. One 311-byte response-owned
  capture per read remains explicit. No transport or latency savings are claimed.
- Pending jobs/body bytes/values/manifests and temporary stored growth have fixed
  admission bounds; entry, byte and manifest pressure converge to the original
  retention limits even while scheduled timers are held. Clear and ownership/
  connection changes fence suspended reads/writes/prunes without resetting the
  old queue's memory accounting.
- Focused checks: cache 37, delivery/auth-loss 23, cost 3, root reads 20, hydration
  13, writer session 11, observer lifecycle 3. Negative controls reproduced held-
  maintenance blocking and stale response repopulation. Review also reproduced
  a missing hydration-401 cleanup, now fixed across all hydration transports.
- Browser checks: cache population 1, startup recovery 7 (rerun after auth fix),
  visible state recovery 3. These also provide the pending Phase 2a/2b offline,
  lost-response, writer/lineage and sidebar recovery evidence. Current guides,
  Prettier, whitespace and both documentation validators pass. Final aggregate
  remains the combined gate after all implementation phases.

## Phase 2d: Selected Locale Accepted

- Implementation: `8bc5a83b6`.
  [Loading contract and all before/after evidence](evidence/locale-loading.md)
  records the exact fixtures, commands, readiness medians, and retry regression.
- Initial HTML JavaScript falls from 389,721 to 159,433 gzip bytes (59.09%);
  only English appears in either static startup closure. Immediate closure
  gzip falls from 1,377,316 to 1,148,933. Existing budgets are unchanged.
- Twelve isolated English/Korean cold/refresh cases preserve the first localized
  composer, improve all four median readiness comparisons, and request only
  English or English plus Korean. Required selected-pack transfer stays accounted.
- Three real-browser switching/failure journeys pass. A native Chromium failed-
  module cache prevented memo-only retries; build-owned URL references with a
  retry query resolve that actual failure without prefetching other packs.
- Focused language, startup, resource/database, onboarding, settings, reactive UI
  and build-report tests pass as enumerated in the evidence. Current guides and
  both documentation validators, Prettier and whitespace checks pass. Phase 2
  meets its budgets; final aggregate remains pending until all implementation ends.

## Phase 3: Selected Repository Primitives Accepted; Cutover In Progress

- Implementation: `93d99a957`. New preflight
  loader returns selected configuration and separate owner metadata without
  reading transcripts/Hypa bodies. New assembly loader reads the selected target
  and required collection bodies; neither scans asset metadata. Root prompt
  cards are read only for the exact selected default scaffold's absent-body
  fallback. Explicit null/empty/owned bodies and nondefault absence stay distinct.
- ID and module-namespace expression indexes prevent hidden unrelated JSON scans
  behind selected lookups. Duplicate prompt owners fail closed, module ID/
  namespace matching preserves collection order, and nonempty extracted tables
  retain precedence over embedded fallback. Index setup is idempotent and does
  not advance the revision.
- Referenced speaker names and misses are captured synchronously, including
  initial user/named rows because later role changes can expose their speaker
  ID. Supported Lua/V2 operations cannot introduce new saying IDs: full-history
  replacement keeps only role/data, and other mutations edit/remove existing
  fields. The captured name map therefore needs no later SQL lookup or broad
  sibling-character shells. Existing working-character lookup remains primary.
- `pnpm test -- server/fastify/__tests__/generationInputLoaders.test.ts`: 14
  passed. Tests cover row/asset scope, indexed query plans, ordering/duplicates,
  legacy embedded scope, template ownership, stable Hypa selection and speaker
  snapshot behavior. Prettier, whitespace and documentation checks pass.
- Route cutover, concrete type/schema closure, immutable configuration/working
  ownership, combined cost/timing and browser evidence remain in progress. F02
  and F09 remain open. Settings still occupy one configuration JSON row; its
  embedded profile/credential/agent arrays need explicit residual-cost evidence
  before final acceptance rather than a universal constant-cost claim.

## Phase 3: Immutable Agent Reader Inputs Accepted

- Implementation: `eca180cd1`. Neutral Agent readers
  and validators accept deep readonly records and nested collections; resolution
  retains the borrowed preset identity while normalized records and execution
  steps remain owned mutable outputs. No aggregate server/browser state moves
  into shared-core, and selection/dependency/output ordering stays unchanged.
- Exact focused tests: `pnpm test -- src/ts/agentPresetRecords.test.ts` (16),
  `pnpm test -- src/ts/agentPresetResolver.test.ts` (12), and
  `pnpm test -- packages/shared-core/src/agentPresetResolverParity.test.ts` (1).
  Frozen modular/legacy inputs and independent nested output edits are covered.
  Prettier, whitespace and documentation checks pass. This supports the ongoing
  immutable generation configuration cutover; F02/F09 remain open.

## Phase 3: Nullable Message Wire Contract Corrected

- Implementation: `706b18bc8`. Command validation
  already permits stored `time: null`, and generation restoration/mutation
  envelopes preserve it, but the SSE schema previously accepted numbers only.
  The schema now describes the supported nullable timestamp without changing
  emitted payloads or normalizing full-history data.
- `pnpm test -- packages/protocol/src/generationSse.test.ts`: six passed, including
  null metadata round trips through mutation/restoration and invalid string
  rejection. Prettier, whitespace and documentation checks pass. This correction
  was exposed by concrete prompt types; full F09 acceptance is still pending.

## Phase 3: Concrete Immutable Consumer Contracts Implemented

- Implementation: `8de501a4a`. Finite settings and all six
  participating record views replace the unrestricted prompt contract. Five
  persistence/provider/memory/preflight boundaries validate a generated schema,
  preserve imported extension data, and reject invalid known fields without
  leaking values. Deep readonly configuration is borrowed; mutable character,
  target transcripts, global variables and scalar overlays have explicit owners.
- Focused exact tests: decoder 21, compiler contract 1, assembly 142, Lua 60,
  lorebook 85, modules 15, templates 71, dispatch profile options 100, memory
  worker 24, display 3, raw translation 33, completion 96, proxy 32, BardWiki
  apply 12 and rebuild 5. Native Node ESM imports pass. Details are in the
  [generation input evidence](evidence/generation-inputs.md).
- The browser accepted-send suite passes all 11 cases on the combined worktree.
  This validates native imports, reload/retry/stop/recovery and concurrent chats;
  it does not close performance acceptance.
- Three matched isolated before/after timing cycles confirm improved large
  unrelated-library preparation but a small-case regression: pooled assembly
  median 2.190 to 2.792 ms. The original 2.409 ms budget is unchanged. F02 and
  the phase gate remain open while this added per-request work is investigated.
  Root route/cost/durable integration is still the next separate commit.

## Phase 3: Selected Route Cutover Implemented

- Implementation: `0afc940ca`. Both readiness and actual
  assembly use selected repository inputs; direct preview retains ID-specific
  missing-entity errors, and malformed known inputs reject before acceptance.
  Accepted sends/retries build a new snapshot after their own revision boundary.
  Provider fallback preserves primary settings and shares readonly configuration.
- Exact focused tests: generation chat 181, durable generation 69, selected
  loaders 16, operation startup 1, and structural preparation costs 3. Accepted
  send browser 11 passes. The durable fixture changes a prompt between acceptance
  and assembly and verifies the new prompt plus accepted message. Invalid known
  input leaves message/operation/revision/provider state untouched.
- All original structural budgets pass: selected snapshot 2,715 bytes, preflight
  5 rows with zero messages, four-message assembly 9 rows, zero asset rows and
  zero aggregate database clones. Extra configuration-row parsing is exposed
  separately. No numeric timing budget was raised; the small-case timing gate
  remains open. [Matched investigation samples](evidence/generation-timing-investigation.json)
  retain all three before/after cycles, including failures.

## Phase 3: Bounded Query Program Reuse Implemented

- Implementation: `cb914e641`. Profiling found native
  SQLite preparation/read work dominant in the small fixture; repeated CBS
  adapters account for less than 0.001 ms per assembly and are left unchanged.
  Selected readers reuse at most 16 fixed programs per connection, with at most
  4,096 aggregate parameter bytes per retained program. Larger selectors bypass
  reuse. No rows, snapshots, or configuration values are memoized.
- A repeated ordinary assembly performs zero new query compilations while still
  returning all nine expected rows. Later prompt/history writes and independent
  connections remain fresh. Oversized selectors demonstrably recompile and do
  not replace the retained small-selector program. Instrumentation now observes
  statement execution and restores its prototype spies before timing.
- Exact focused checks: selected loaders 18, preparation probes 4, chat generation
  181 and durable generation 69. Structural budgets remain unchanged and pass.
  The named embedded-character compatibility axis is now measured at 0/12/48
  unrelated units: selected output 2,277/140,134/553,918 bytes and total settings
  JSON read 4,222/600,872/2,393,168 bytes per preparation. It still performs zero
  aggregate database clones or asset metadata reads; no ordinary-path budget is
  incorrectly applied to this explicit legacy exception.
- Timing acceptance remains open. All matched measurements are retained for
  final comparison; startup validator compilation is the next bounded change.

## Phase 4a: Design and Bounds Accepted Before Implementation

- Two read-only Luna areas cross-checked backup and GC interleavings. One
  coordinator per normalized data directory admits one exclusive backup/import/
  restore/delete operation with zero queued operations, four compatibility-save
  mutations or four operations staging live assets across awaits, and one GC
  sweep. Conflicting admission returns transient HTTP 503 `maintenance_busy`.
  Successful backup HTTP responses still wait for completed publication.
- Backup filesystem work uses two workers, one buffered entry per directory at
  at most 32 directory levels, and 64 KiB stream buffers. Deeper legacy extras
  fail closed rather than creating an unbounded traversal stack. An exclusive lease starts before SQLite's backup
  await and lasts through verification, publication or failure cleanup. Internal
  safety snapshots and retention reuse an explicit owner token. No SQLite
  transaction spans an await. Shutdown rejects admission, signals cancellation,
  and drains leases before closing SQLite.
- Required references come from the captured SQLite snapshot, including pending
  finalization/catalog/plugin-storage surfaces. Missing metadata or required
  bytes cannot publish success. Existing optional orphan files and directory
  extras remain included when encountered; extras are not claimed to share the
  SQLite snapshot's exact instant. Compatibility writes/removes and multi-await
  live staging are excluded throughout capture. Raw synchronous uploads remain
  allowed and may add harmless extras.
- Restore recovery policy: only its automatic safety snapshot may fill missing
  captured-live bytes from the verified, pinned restore source by identical hash
  and declared size. It does not repair or change live files during capture.
  Missing in both locations, or corrupt fallback bytes, still fails closed.
  This preserves recovery after live-file loss without incomplete-success backups.
- Existing synchronous reference-report work is an explicit intermediate 4a
  residual; the later bounded scan must cover backup verification as well as GC
  before Phase 4 latency acceptance. Restore's existing journal/synchronous
  swap transaction remains authoritative.

## Phase 3 Accepted: Standalone Validators and Final Measurement

- Implementation: `e4fc41def`, following `8de501a4a`
  (finite immutable consumers), `0afc940ca` (selected live routes), `cb914e641`
  (bounded query programs), and the earlier repository/Agent/wire slices.
- [Complete source, measurements and verification](evidence/generation-inputs.md)
  retains the original baseline, every failed intermediate comparison, all final
  paired samples, the settings-row and named legacy axes, and native import cost.
  Three alternating fresh processes per source retain one warmup/three measured
  repetitions per fixture. All nine samples contribute to each final median.
- Original small preflight/assembly limits 0.453/2.409 ms are met at 0.379/2.327 ms;
  large unrelated limits 1.066/2.812 ms are met at 0.262/1.608 ms. All original
  row/clone/snapshot budgets pass, including zero aggregate database clones and
  zero unrelated asset rows. No numeric budget was raised or sample discarded.
- Standalone validators use the unchanged schema/options and remove runtime
  schema compilation. Three alternating native processes measure median decoder
  import 541.0 to 97.1 ms; first validation stays similar and module parsing is
  still accounted. Observed post-import heap falls from 60.2 to 9.46 MB without
  forced GC; this is not a retained-heap guarantee.
- Final decoder 23 and compiler-contract 1 tests pass. The final native-browser
  accepted-send suite passes all 11 cases with the generated runtime. Other exact
  route/prompt/provider/memory/script checks and the original structural budgets
  pass as listed in evidence. Prettier, whitespace and both documentation
  validators pass. Phase 3 is accepted; final aggregate remains pending until
  all implementation phases finish. Phase 4's temporary sequencing exception
  no longer carries an open dependency.

## Phase 4a: Backup Copy and Ownership Slice Implemented

- Implementation: `2e2c321e9`. Exclusive protection spans SQLite's
  await, required-byte verification, asynchronous copying, publication or cleanup.
  Shared save/staging leases close the races around mutable compatibility files
  and multi-await live asset conversion. Same-hash/size restore fallback preserves
  recovery of missing live bytes. Pre-snapshot write fences reject destructive
  replacement when accepted ordinary or revision-free writes arrive meanwhile.
- Independent review found a post-commit retention await that delayed restored
  generation reconciliation/event publication. The fixed synchronous callback
  runs those effects before retention yields. A controlled held-retention test
  proves later settings events stay ordered and newly accepted current-instance
  generation work is not marked abandoned.
- Retention now traverses manifests asynchronously and retains only the configured
  newest automatic selection plus at most two protected IDs. It ignores manual/
  malformed records without collecting them. Created-time/id tie selection and
  protected manual-versus-automatic capacity retain their prior outcomes.
- `preClose` starts cancellation/admission closure; `onClose` drains before closing
  SQLite. A held real HTTP backup exposed keep-alive drain after cancellation;
  cancelled backup responses now close the connection. The shutdown regression
  verifies cleanup and lease release before close completes.
- Exact focused tests: maintenance coordinator 10, staging 7, backup maintenance
  22, backups 53, local backup database 4, GC 19, save codec 46, legacy storage 13,
  local file import 3, Realm 30: 207 passed. Maintenance cases use real SSE,
  authenticated GET/command/upload progress during held copies, conflicts,
  missing/corrupt/fallback bytes, stale safety captures, cancellation and shutdown.
  Prettier, whitespace and documentation validators pass. No cost matrix or
  aggregate is claimed for this intermediate slice.
- The complete reference report and captured asset metadata array are still
  synchronous/unbounded by batch. Shared bounded discovery must replace them in
  backup and GC before Phase 4 acceptance. Public backup listing and journaled
  restore staging/swap/recovery retain their existing synchronous costs.

## Phase 4b: Bounds Before Implementation

- Discovery pages read at most 64 source rows, yielding after 256 KiB or 4 ms of
  work. A single projected owner/scalar can exceed the byte/time slice; expose
  its largest-row measurement instead of adding an incompatible storage limit.
  Distinct reference/chat IDs spill to one caller-owned scratch SQLite file with
  a 2 MiB cache, rather than full-corpus JavaScript report arrays. Backup and GC
  share this vocabulary and scanner; scratch cleanup precedes lease release.
- Reclamation processes at most 16 candidates synchronously per transaction,
  rechecking authoritative write/lineage, external-connection, protection and
  upload-activity fences. Metadata and canonical-file deletion have no await
  between them; asynchronous work never unlinks a canonical path later.
  New writes/staging or stale discovery conservatively stop the sweep.
- One sweep may run per directory. Results retain at most 1,024 deleted IDs/file
  names plus complete counts, and candidate/file traversal remains paged.
  Existing grace/staging protection remains. These bounds complement the original
  unchanged API/event-loop latency targets; final isolated comparison is pending.

## F01 Follow-up Accepted: Agent Preset Deletion

- The dedicated deletion reproduction at `2e2c321e9` returned HTTP 200 and
  correct cleanup counters but deleted all settings/document/version/search/link
  rows for both affected and unrelated BardWiki chats. Scope amendment
  `9ca9bc918` authorized the targeted correction.
- `server/fastify/src/commands/agentPresets.ts` now uses the existing targeted
  cross-owner mutation boundary, loads settings, selects matching chat payloads,
  and updates only those chats and matching stored loadout positions. It retains
  complete Agent/preset/loadout validation, default cleanup, legacy embedded
  owners, one revision/event, receipt replay, and atomic rollback. Character and
  chat identities are never replaced by this ordinary deletion.
- Exact focused checks: `agentPresetDeletionSafety.test.ts` 13,
  `commands.test.ts` 241, and `commandMutationReceipts.test.ts` 12 passed. The
  dedicated test observes physical SQL writes and all five affected BardWiki
  families, unrelated messages/owners, malformed-input rejection, receipt replay,
  and injected chat/event/receipt failures. This is a correctness correction;
  SQL still examines chat JSON for matches and validates the loadout collection.
  Final combined aggregate remains pending until all implementation finishes.

## Phase 4b: Shared Reference Discovery Primitive

- `server/fastify/src/assetReferenceScan.ts` projects known reference fields in
  source pages of at most 64 rows and spills distinct references/chat IDs to a
  disposable SQLite file with a 2 MiB cache. Cooperative slices yield after
  256 KiB or 4 ms; one existing oversized scalar or native legacy JSON projection
  remains nonpreemptible and is reported by `largestRowBytes`.
- The shared asset-owner vocabulary covers extracted/embedded precedence,
  plugins, catalog entries, pending finalizations, and active/alternate message
  rows. No authoritative transaction/iterator remains open across a yield, and
  scratch cleanup leaves primary write counters unchanged. Signed rowid text
  cursors preserve legacy 64-bit IDs without OFFSET or whole-body projection.
- `assetReferenceScan.test.ts` passes 16 focused cases: owner parity against the
  existing report, exclusions/malformed fields, alias/orphan ownership, signed
  cursors, paged progress, oversized fields, cancellation and scratch recovery.
  Backup/GC cutover and original latency acceptance are the next slice.

## Phase 4b: Backup/GC Cutover Implemented; Timing Open

- Backup reference verification now uses the shared scanner over its captured
  SQLite database and streams metadata in 64-row pages into the two file workers.
  GC owns one maintenance lease, discovers asynchronously, and reclaims at most
  16 candidates per transaction/turn. Stale write, lineage, external-connection,
  staging or upload-activity fences retain the remaining candidates. Canonical
  unlink occurs only immediately after successful commit with no intervening await.
- Exact focused checks pass: scanner 16, GC 19, GC scheduling 16, backup
  maintenance 22, backups 53, local backup database 4, and the default small
  maintenance probe 1 (matrix skipped). Held GC tests prove real authenticated
  HTTP and command SSE progress, reference/upload races, cancellation/drain,
  commit failure byte preservation, re-upload after a committed batch, and full
  counts with a 1,024-entry result cap. Existing backup interleavings still pass.
- The first isolated matrix retains all nine samples in
  [maintenance investigation](evidence/maintenance-investigation.json).
  Every fixture makes API/turn progress during GC and post-snapshot backup.
  Large GC median max-gap/API is 13.306/13.794 ms, within original
  16.117/16.576 ms limits. Backup 16.244/16.773 ms exceeds 7.924/8.142 ms;
  Phase 4 remains open. Median large total completion is 1,181.697 ms backup
  and 594.333 ms GC, versus 23.690/32.234 ms baseline; async overhead is visible.
- A separate exact `serverLoadCostHarness.test.ts` run exposed a Phase 3 prompt
  fixture returning HTTP 400; diagnosis is pending. This does not invalidate
  the dedicated maintenance cases, and no final aggregate has been run.

## Phase 4 Timing Investigation and Directory Bound Revision

- An opt-in V8 performance observer attributes the backup's >5 ms event-loop
  gaps to minor/major garbage collection during the continuous authenticated
  request probe. Both diagnostic samples and the original uninstrumented failure
  remain in the investigation artifact; no sample or original budget is removed.
- The first copy traversal's one-entry directory buffer causes an asynchronous
  filesystem refill for every already-copied asset name. Before tuning it, revise
  the explicit traversal bound to 64 entries per level at at most 32 levels
  (2,048 buffered Dirents maximum). The file-worker bound stays two and hash
  buffers stay 64 KiB. This trades bounded directory metadata for fewer filesystem
  round trips; it does not increase concurrent copies or retain a corpus array.
- With the revised directory buffer and bounded small-file hash buffer, large
  median total backup time improves to 832.159 ms from 1,181.697 ms, but median
  max-gap remains 24.174 ms in the diagnostic run. Every large >5 ms gap still
  aligns with V8 collection. The 22 backup interleaving cases pass. Small files
  use at most one 64 KiB buffer per worker; large files retain streaming hashes.
- A diagnostic removing successful-request Vitest matcher allocation still
  records 19.446 ms backup gaps, so that probe change is reverted. Original
  comparison budgets and continuous-request concurrency remain unchanged.
- The cost harness's supported sparse-input rejections are fixed in
  `ee9d61213`; decoder 26, strict compiler 1, templates 72 and all 38 load harness
  cases now pass without changing the imported hydration fixture.
