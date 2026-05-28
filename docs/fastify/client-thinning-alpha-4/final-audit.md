# Alpha 4 Final Audit

Date: 2026-05-28

Status: **closed.** Alpha 4 is complete. Buckets 0-6 plus the final docs/
ladder closeout (Bucket 7) landed against the audit-as-contract gate; all
ten B1-B10 findings are resolved and the rebuilt `util/client-thinning-audit.ts`
is the standing structural defense for every exit criterion.

## Verdict

The Alpha 4 invariant is satisfied for the scoped Fastify-served web mode:

> In Fastify-served web mode:
> 1. The browser is a projection of server-owned durable state. No client path
>    writes durable state outside server commands; no command path mints stable
>    ids the client cannot observe; no passive read claims write ownership.
> 2. Server-owned bytes and identifiers are preserved across the durable
>    boundary: backup/restore copies every server-owned data directory, asset
>    uploads carry honest content metadata, asset reads gate to the documented
>    surface.
> 3. Long-lived server state is bounded: every in-process accumulator that
>    grows with requests has an eviction policy.
> 4. The audit script asserts these invariants structurally, not by
>    pattern-matching past fixes.

Point 4 is the difference from Alpha 3. The audit script is now derived
from authoritative source structures (`SECRET_PATHS`, the asset-walker
collector table, route registrations, `dispatch*` exports, dataDir
children, `saveAsset` callers, process-lifetime accumulators), not from
the literal pre-fix text. Every behavior closure below is gated by the
invariant the audit defends.

## Closeout Summary

| Criterion | Status | Proof |
| --------- | ------ | ----- |
| A4EC1 - Audit is invariant-derived | Closed | Bucket 0 rewrote `util/client-thinning-audit.ts` around `SECRET_PATHS`, asset-walker collector, route AST walk, `dispatch*` enumeration, `KNOWN_DATA_DIR_CHILDREN`, `BOUNDED_ACCUMULATOR_DECLARATIONS`. |
| A4EC2 - Composite command fan-out serialized | Closed | Bucket 1 routed all seven fan-out sites through `runOptimisticCommandSequence` / `runChatCommandSequence`. Each site has a dedicated regression test asserting the sequencer threads revisions across calls. |
| A4EC3 - No command-path id minting (transitive) | Closed | Bucket 2 split `createLorebookEntryRecord` into `validateLorebookEntry` + `repairLorebookEntry`, added `validateLorebookEntries` + `validateGlobalLorebookCreate`, switched the 5 red routes to the no-mint validators, and deleted the dead `repairPresetRecord` export. A4R3 walks the call graph and confirms no `randomUUID()` is reachable. |
| A4EC4 - Backups preserve every server-owned data directory | Closed | Bucket 3 wired `KNOWN_DATA_DIR_CHILDREN = ['db.json', 'assets', 'risu.db', 'save']` and added round-trip coverage for memory tables + legacy storage. |
| A4EC5 - In-memory accumulators bounded | Closed | Bucket 4 capped `auth.knownKeyHashes` at 4096 with LRU eviction + trim-on-load, plus regression coverage. |
| A4EC6 - `saveAsset` callers declare honest metadata | Closed | Bucket 5 added `// audit:image-default` markers at every image-only caller and threaded real filenames at every non-image caller. A4R-saveasset enforces the contract. |
| A4EC7 - Asset read URL gate narrow | Closed | Bucket 6 narrowed `getFileSrc` in Fastify mode to documented shapes only; A4R7 asserts the constraint structurally. |
| A4EC8 - Globally-addressed routes normalize first | Closed | Bucket 6 also added `normalizeAllCharacterChats` before `requireChatLocation` in the chat lorebooks route; A4R4 enforces the invariant across every resolver caller. |
| A4EC9 - Docs/status/ladder reconciled | Closed | This file, `history.md`, `docs/fastify/status.md`, and `docs/fastify/status/next-steps.md` agree after the full ladder passes. |

## Bucket 1 Closeout (all seven fan-out sites)

Two sites landed mid-session in the partial commit (`SideChatList` drag
end, `applyModule` child replacements). The remaining four landed in
follow-up:

- `src/ts/process/sendChatContext.ts` - `setupSendChatContext` now collects
  the lastInteraction patch and the message-id backfill into one factory
  list, then runs through `runOptimisticCommandSequence` with a chat-state
  rollback that covers both mutations. Regression test
  `src/ts/process/__tests__/sendChatContext.test.ts` asserts the second
  command reads the revision returned by the first.
- `src/ts/plugins/plugins.svelte.ts` - `dispatchModuleCollectionPatch` and
  `dispatchEnabledModulesPatch` both collect their diffs into a factories
  array and run through the sequencer once. New tests in
  `src/ts/plugins/plugins.test.ts` cover both shapes and verify the
  advancing revision.
- `src/ts/plugins/apiV3/v3.svelte.ts` - `setCharacterToIndex` and
  `setChatToIndex` now build their factory lists through new
  `prepareCompatibleCharacterUpdate` / `prepareCompatibleChatUpdate`
  helpers and run through `runOptimisticCommandSequence` directly, so the
  V3 plugin call sites no longer host bare `dispatchCompatible*` calls
  inside the `makeRisuaiAPIV3` scope. The existing
  `dispatchCompatibleChatUpdate` is now a thin wrapper over the prepare
  helper. Regression tests in `src/ts/compatibilityAdapters.test.ts`
  cover the prepare helpers + their sequencing.

The audit rule **A4R-fanout** keeps each closed site honest; rerunning it
on the pre-fix tree fails on the same lines the audit reported on
2026-05-28.

## Bucket 2 Closeout (transitive id minting + dead export)

Five red A4R3 routes shared the same chain: command-path → intermediate
helper (`createGlobalLorebookRecord` / `readLorebookEntries`) → `repair*`
mapper → `randomUUID()`. Broken at the intermediate helper:

- `validateLorebookEntry(input, label)` - command-path single-entry
  constructor. No transitive reach to `randomUUID()`.
- `validateLorebookEntries(input, label)` - validates an array, rejects
  missing or duplicate ids, replaces the dead `readLorebookEntries` alias.
- `validateGlobalLorebookCreate(input, label)` - new exported no-mint
  constructor used by `POST /api/v1/commands/lorebooks` in place of
  `createGlobalLorebookRecord`.
- `repairLorebookEntry` / `repairLorebookEntries` retain the
  repair-permissive minting path for the `ensure*` / `normalize*` callers
  reached during import and bootstrap normalization. A4R3 classifies
  those as non-propagating with arg-provenance.

The five routes (`POST /lorebooks`, `PUT /lorebooks/:id/entries`,
`PUT /characters/:id/lorebooks`, `PUT /chats/:id/lorebooks`,
`PUT /modules/:id/lorebooks`) now reach only the no-mint validators.
Regression coverage in `server/fastify/__tests__/commands.test.ts`
exercises missing and duplicate entry ids at every reachable route.

B10 closed by deleting the unused `repairPresetRecord` export at
`server/fastify/src/commands/presets.ts`; the bootstrap-only minting still
happens through `ensurePresetCollection`. `rg "repairPresetRecord"
server/ src/` is now empty.

The EC4 stable-id audit list in `util/client-thinning-audit.ts` was
updated to reference `validateGlobalLorebookCreate` and
`validateLorebookEntries` instead of the deleted `readLorebookEntries`
alias. This is intentional: the audit defends the no-mint validator name
that public routes actually call.

## Verification

Latest full verification on 2026-05-28:

- `pnpm client-thinning:audit`: passed.
- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 80 files passed; 807 tests passed, 4 skipped.
- `pnpm api:test`: 71 files passed; 1274 tests passed.
- `pnpm build`: passed with existing nonblocking warning classes.
- `pnpm smoke:fastify-browser`: build passed and 1 browser smoke test
  passed.

The new audit rules each demonstrably fail on the pre-fix tree (the
2026-05-28 audit run with 9 findings is the recorded before-state) and
pass after the fixes in this closeout.

## Handoff

Alpha 4 has no remaining open buckets. Future Fastify client-thinning
findings should be recorded as a new follow-up workstream rather than
reopening this closed closeout record. When a fresh class lands, extend
`util/client-thinning-audit.ts` with a rule that fails on the pre-fix
tree before adding the behavior fix - the alpha-4 contract is that the
audit defends the invariant, not the past fix.
