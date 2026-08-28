# Phase 3: Persistence, Commands, Events, And Editing Bridges

Status: Complete on 2026-08-29; Phases 0-2 satisfied.

## Objective

Audit whether storage, revisioned commands, event delivery, and optimistic
editing tests prevent data loss, wrong-target mutation, duplicate application,
secret loss, and overbroad rollback.

## Scope

- Database initialization, defaults, migrations, legacy import, and repository
  round trips.
- Command revisions, receipts, idempotency, concurrency, mutation ranges,
  targeted paths, and event ordering/delivery.
- Message/Hypa physical storage, alternates, identity repair, and narrow
  read/write cost contracts.
- Browser command adapters and entity editing bridges for characters, chats,
  settings, presets, personas, loadouts, modules, lorebooks, and scripts.
- Dirty-field preservation, stable IDs, dependency ordering, rollback rebasing,
  lifecycle flush, and accepted/queued/failed UI projection.

Primary discovery guides:

- [`persistence-commands-and-events.md`](../../../tests/persistence-commands-and-events.md)
- [`domain-mutations-and-editing-bridges.md`](../../../tests/domain-mutations-and-editing-bridges.md)

## Audit Questions

- Do assertions reach exact SQLite rows, revisions, events, and visible rollback
  where the risk requires them?
- Are idempotency, stale writers, concurrent siblings, stable target identity,
  and partial success proved rather than implied by mocks?
- Do implementation-aware bridge tests enforce a deliberate state machine, or
  merely duplicate current implementation details?
- Are narrow read/write budgets paired with correctness and not treated as
  behavior substitutes?
- Can repeated mutation/focus/race matrices share harnesses without losing
  entity-specific ownership?

## Required Outputs

- Per-command and per-bridge protected-contract map.
- Storage/API/browser companion evidence and intentional overlap notes.
- Findings for obsolete resource shapes, source-string assertions, duplicate
  matrices, missing physical-row proof, broad rollback, and missing race cases.
- Removal/consolidation proof for any scenario or helper retired.

## Exit Criteria

- Every Phase 3 test and shared persistence helper has a disposition.
- Transcript, identity, revision, receipt, transaction, and rollback invariants
  retain unique regression proof.
- Critical/High data-integrity findings are resolved or gated with explicit
  ownership.
- Load-cost gates remain isolated and meaningful.
- Count deltas, retained defense in depth, and residual gaps are recorded.

## Validation

- Focused frontend bridge and Fastify persistence/command tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- Relevant browser recovery/reroll specs when the visible durable loop changes
- Isolated load-cost tests with documented worker limits
- `pnpm format:check`
- `git diff --check`

## Completed Audit Record

The phase reviewed all 52 category-C owners and all 1,565 cases present when the
slice opened. Strengthening added 18 transaction, storage, replay, lifecycle,
and counterexample cases, so the same owners now collect 1,583 cases. Every
file is retained as distinct evidence at its current category and lane. No file
or case was removed, merged, or reclassified.

### Contract And Disposition Map

| Test owner | Cases | Production contract | Disposition |
| --- | ---: | --- | --- |
| `server/fastify/__tests__/commandCollectionRange.test.ts` | 60 | Collection semantics plus permitted physical table/row ranges | Keep |
| `server/fastify/__tests__/commandFloorUnblock.test.ts` | 7 | Load-bearing narrow read floors | Keep |
| `server/fastify/__tests__/commandMessageFreeCeiling.test.ts` | 8 | Message-free ceiling and broad-fallback boundary | Keep |
| `server/fastify/__tests__/commandMetrics.test.ts` | 1 | Runtime mutation timing and physical-write metrics | Keep |
| `server/fastify/__tests__/commandMutationBudget.test.ts` | 9 | Complete mutation-path/table-budget policy | Keep; strengthened by `TSA-P03-006` |
| `server/fastify/__tests__/commandMutationReadNarrowing.test.ts` | 21 | Scoped command reads avoid unrelated state | Keep |
| `server/fastify/__tests__/commandMutationReceipts.test.ts` | 12 | Receipt persistence, replay, lineage, ACK, and collision rejection | Keep; strengthened by `TSA-P03-005` |
| `server/fastify/__tests__/commandSingleRowPaths.test.ts` | 21 | Single-row writers preserve unrelated physical identities | Keep |
| `server/fastify/__tests__/commands.test.ts` | 222 | Revisioned command auth, validation, transaction, event, and domain semantics | Keep; strengthened by `TSA-P03-005` |
| `server/fastify/__tests__/databaseDefaults.test.ts` | 22 | Legacy normalization and canonical defaults | Keep |
| `server/fastify/__tests__/databaseInitialization.test.ts` | 19 | Fail-closed first-run classification over all durable state | Keep; strengthened by `TSA-P03-001` |
| `server/fastify/__tests__/db.test.ts` | 19 | Schema, migration, constraints, preservation, and reopen | Keep; strengthened by `TSA-P03-007` |
| `server/fastify/__tests__/durableDeleteIdempotency.test.ts` | 30 | Semantic delete idempotency and same-receipt replay | Keep; strengthened by `TSA-P03-005` |
| `server/fastify/__tests__/events.test.ts` | 25 | Persisted/live event ordering, replay, auth, and cleanup | Keep |
| `server/fastify/__tests__/legacyDatabaseImport.test.ts` | 4 | Transactional legacy import, rollback, checkpoint, and quarantine | Keep |
| `server/fastify/__tests__/legacyStorage.test.ts` | 13 | Authenticated legacy byte storage and atomic replacement | Keep |
| `server/fastify/__tests__/lorebookIdentityRepair.test.ts` | 5 | Command-input lorebook identity repair and validation | Keep |
| `server/fastify/__tests__/messageStore.test.ts` | 28 | Message/alternate/Hypa storage and safe surgical persistence | Keep; strengthened by `TSA-P03-002` |
| `server/fastify/__tests__/missingDatabaseGuard.test.ts` | 17 | Prior-install evidence blocks implicit database creation | Keep |
| `server/fastify/__tests__/repositoryWriterKit.test.ts` | 11 | Targeted repository writers preserve unrelated state | Keep |
| `server/fastify/__tests__/resourceReads.test.ts` | 20 | Authenticated resource projections, bounds, cache, and secret exclusion | Keep |
| `server/fastify/__tests__/targetedMutationPaths.test.ts` | 6 | Targeted mutation configuration invariants | Keep |
| `src/ts/alternateGreetingCommands.test.ts` | 5 | Durable greeting selection and rollback | Keep |
| `src/ts/alternateGreetingMutation.test.ts` | 2 | Pure greeting-index repair | Keep |
| `src/ts/characterCommands.test.ts` | 80 | Optimistic character CRUD/order/selection and narrow rollback | Keep |
| `src/ts/chatCommands.test.ts` | 183 | Chat/message/folder mutation, chunking, identity, and rollback | Keep |
| `src/ts/personaMutationCertificate.test.ts` | 2 | Canonical persona mutation certificates | Keep |
| `src/ts/process/__tests__/command.resourceGuard.test.ts` | 22 | Process mutations use trusted resource writes and commands | Keep |
| `src/ts/process/coldstorage.test.ts` | 3 | Stable-ID cold-storage recovery | Keep |
| `src/ts/server/bridgeFlush.test.ts` | 3 | Lifecycle keepalive flush and shared listener ownership | Keep; strengthened by `TSA-P03-004` |
| `src/ts/server/characterBridge.svelte.test.ts` | 25 | Character draft merge, ownership, fencing, and rollback | Keep |
| `src/ts/server/chatBridge.svelte.test.ts` | 19 | Chat/folder draft merge, ownership, fencing, and rollback | Keep |
| `src/ts/server/commands.test.ts` | 163 | Browser command adapters, receipts, projections, and rollback | Keep |
| `src/ts/server/durableMutationDispatch.test.ts` | 19 | Durable staging, transport outcomes, dependencies, and settlement | Keep |
| `src/ts/server/durableMutationTerminalRejection.test.ts` | 10 | Terminal rejection rolls back only failed attempted state | Keep |
| `src/ts/server/events.test.ts` | 9 | Authenticated SSE parsing, replay cursor, abort, and close | Keep |
| `src/ts/server/lorebookBridge.svelte.test.ts` | 102 | Lorebook hydration, stable entries, projection fences, and rollback | Keep; strengthened by `TSA-P03-003` |
| `src/ts/server/lorebookBridge.test.ts` | 23 | Durable lorebook ownership, replay, and scoped restoration | Keep |
| `src/ts/server/pendingBridgeFlushRegistry.test.ts` | 4 | Lazy flusher/resetter replacement and targeted ownership | Keep |
| `src/ts/server/persistenceActivity.svelte-node.test.ts` | 2 | Reactive pending-persistence activity | Keep |
| `src/ts/server/replacementDatabaseOwnership.svelte-node.test.ts` | 2 | Replacement clears old bridge/outbox ownership | Keep |
| `src/ts/server/resourceReads.svelte-node.test.ts` | 18 | Client resource transport/auth/encoding validation | Keep |
| `src/ts/server/resourceWriteGuard.test.ts` | 8 | Untrusted resource writes fail while scoped writes succeed | Keep |
| `src/ts/server/scopedLorebookMutationUiState.test.ts` | 2 | UI outcomes bind to operation, chat, and entry identity | Keep |
| `src/ts/server/scriptDefinitionBridge.svelte.test.ts` | 72 | Script/trigger drafts, watchers, fencing, and rollback | Keep |
| `src/ts/server/scriptDefinitionMutations.test.ts` | 14 | Sparse/create/delete/reorder/full definition planning | Keep |
| `src/ts/server/settingsBridge.durable.test.ts` | 6 | Settings outbox lineage across replacement | Keep |
| `src/ts/server/settingsBridge.svelte.test.ts` | 61 | Settings coalescing, owner reseed, fencing, and rollback | Keep |
| `src/ts/storage/autoStorage.test.ts` | 2 | Storage-backend selection | Keep |
| `src/ts/storage/database.svelte.test.ts` | 135 | Resource facade and split-preset hydration/replay | Keep |
| `src/ts/storage/exportAsDataset.test.ts` | 3 | Strict hydration, serialization, download, and success order | Keep |
| `src/ts/storage/fastifyStorage.test.ts` | 4 | Authenticated legacy storage client adapter | Keep |

### Defense In Depth

| Layer | Distinct failure mode retained |
| --- | --- |
| Pure planners/certificates | Sparse definition, greeting, persona, rollback, and targeted-path invariants fail without transport noise. |
| Client bridges/outbox | Stable targets, dirty fields, queued/failed projection, lifecycle flush, lineage, and owner changes fail before API integration. |
| Fastify command routes | Authentication, revisions, same-base races, receipts, event transactions, validation, and domain response shapes fail against real routes. |
| Direct SQLite/filesystem | Schema upgrades, row identity, write ranges, transcript prefixes, legacy migration/storage, and initialization evidence fail on physical state. |
| Browser companions | Phase 2 response-loss/event-gap/takeover and reroll-reload journeys fail across the compiled SPA, Fastify, and SQLite. |

Range/floor/ceiling tests remain paired with semantic command and physical-row
owners; nonnegative timings are diagnostic rather than claimed latency gates.
Large bridge matrices retain entity-specific identity and rollback evidence even
where their deferred-promise harnesses are structurally similar.

### Findings And Residuals

- `TSA-P03-001` makes first-run classification fail closed for rows in any
  current or future user-state table while permitting only known technical seed
  rows and a lone malformed settings row.
- `TSA-P03-002` requires the live SQLite transcript to match the assembly-start
  prefix before the append-only generation fast path inserts a tail.
- `TSA-P03-003` fences pending module lorebook drafts when an authoritative
  module collection projection arrives.
- `TSA-P03-004` makes shared lifecycle-flush teardown handles idempotent.
- `TSA-P03-005` proves ordinary same-base serialization, event-write rollback,
  and same-mutation-ID replay for every durable DELETE family.
- `TSA-P03-006` replaces mutation-path regular-expression discovery with a
  TypeScript AST oracle covering quote, template, table, and conditional forms.
- `TSA-P03-007` asserts migrated receipt response payloads survive schema
  upgrades, not merely their keys and metadata.
- `TSA-P03-008` retains bounded Medium residuals for tracked historical SQLite
  fixtures, stable-ID fail-closed hardening in transient duplicate/index states,
  mounted rollback companions, a multi-step browser apply/replay journey, and
  consolidation of repeated bridge/range harnesses. Phase 13 owns the
  cross-suite additions/consolidation decision; Phase 14 rechecks the residual.

All demonstrated Critical/High findings are fixed. The remaining residuals do
not justify removing or merging an owner and do not weaken the existing
revision, receipt, transaction, transcript, identity, or rollback invariants.
