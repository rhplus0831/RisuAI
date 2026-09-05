# Maintainability and Performance Status

Updated: 2026-09-05

## Execution Cursor

- State: Phases 0–2 accepted; executing Phase 3 generation inputs and types.
- Opening source: `2a1abfbf937895d598b92dfd3724ef6a501dd7fd`.
- Execution source: `2d9290bfc` (opening implementation plus plan), clean at task start.
- Next phase: [3. Generation inputs and types](phases/phase-3-generation-inputs-and-types.md), slice 3a.
- Next task: define concrete server-owned generation views, then narrow selected
  configuration/history reads and separate immutable configuration from working state.
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
| [3. Generation inputs and types](phases/phase-3-generation-inputs-and-types.md) | F02, F09 | Executing 3a | Accepted dependency/type inventory; explicit views next |
| [4. Server maintenance](phases/phase-4-server-maintenance.md) | F07 | Pending Phase 3 | None |
| [5. Transcript residency](phases/phase-5-transcript-residency.md) | F08 | Pending Phase 4; implementation decision open | None |
| [6. Shared policy and closeout](phases/phase-6-shared-policy-and-closeout.md) | F10; all closeout evidence | Pending prior phases | None |

## Finding Dispositions

| Finding | Disposition | Missing completion evidence |
| --- | --- | --- |
| F01 | Fixed; targeted creation and pre-normalization receipt fingerprint | Final combined aggregate remains pending |
| F02 | Open; preparation baseline accepted | Narrowed reads/clones and behavior parity |
| F03 | Fixed; scoped metadata and organization captures | Final combined aggregate pending |
| F04 | Fixed; bounded background writes/pruning and lifecycle fences | Final combined aggregate pending |
| F05 | Fixed; one owned normalization per staged/replaced intent | Final combined aggregate pending |
| F06 | Fixed; selected loading, readiness and real-browser chunk retry | Final combined aggregate pending |
| F07 | Open; source-confirmed work | Stall baseline, API progress, backup/GC consistency |
| F08 | Open; large baseline exceeds heap/page-layout budgets | Recorded implementation/retention decision and after evidence |
| F09 | Open; source-confirmed type gap | Explicit prompt views and compiler-enforced boundary coverage |
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

- The ten audited findings remain the scope. F01 and F03–F06 are fixed; the
  other findings have accepted baselines and remain open until their owning
  implementation/decision phases. No finding has been silently deferred or added.
- Phase 0 precedes broad benchmarking because F01 is a reproduced correctness
  failure. Performance measurement must not delay its repair.
- F08 retains an implementation decision gate. A measured decision to keep
  paging must record its supported fixture envelope and revisit trigger.
- The single-writer model, durable outbox, revision/event ordering, and existing
  shared-package boundaries remain invariants, not optimization targets.

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

- Implementation: accompanying shared Agent-input commit. Neutral Agent readers
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
