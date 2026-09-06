# Phase 2: Browser Work Reduction

Findings: F03, F05, F04, F06. Dependency: Phase 1 baselines accepted. Execute
2a through 2d as separate slices; progress belongs in [status.md](../status.md).

## 2a: Sidebar Rollback Scope (F03)

Owners: `src/ts/chatCommands.ts`, `src/lib/SideBars/SideChatList.svelte`.
Read [navigation UI](../../../../src/docs/svelte-navigation-ui.md) and
[mutation recovery](../../../../docs/structure/durable-mutations-and-recovery.md).

- Classify each remaining `currentChatStateSnapshot` caller by actual writes.
  Start with folder folding/metadata, then create/delete/reorder organization.
- Capture scalar fields, affected IDs/order, and required owner metadata; leave
  message bodies and unrelated character rows out of structural rollback.
- Preserve operation ownership, projection epochs, pending drafts, writer loss,
  accepted/queued/failed outcomes, and authoritative event reconciliation.
- Prove a failed older operation does not overwrite a newer edit or background
  generation. Structural operations still need a complete snapshot of their
  own affected structure; removing required rollback data is not optimization.

Exit: fixed-size folder edits have clone work independent of unrelated history;
organization snapshots contain only affected structure. Tests preserve unrelated
row/message identities on success and restore only owned changes on failure.
Use `src/ts/chatCommands.test.ts` and
`src/lib/SideBars/SideChatList.svelte.test.ts` as existing verification owners.

## 2b: Normalize Durable Intent Once (F05)

Owner: `src/ts/server/pendingMutationOutbox.ts`.

- Separate validation/ownership of external mutable intent from helpers reading
  an already normalized snapshot. Derive projection targets and size metadata
  from that snapshot without another deep clone. Introduce an internal normalized
  helper or equivalent; preserve validation for public helpers that still accept
  external intent. In particular, staging must not call a target helper that
  immediately invokes `normalizeIntent` again.
- Preserve an immutable captured payload even if the caller edits its original
  object after staging. Treat frozen JSON values, unsupported values, request
  limits, payload limits, and generation-operation intent kinds explicitly.
- Keep encrypted storage, fresh receipt IDs on restaging, ordering, predecessor
  draining, atomic acknowledgement, and persistence-failure fallback unchanged.

Exit: one normalization ownership boundary for ordinary staging; target
extraction adds no payload clone. Encryption/transport serialization remains
accounted for separately. Exact captured bytes and replay semantics match the
baseline; stale restaging cannot dispatch the replacement under an old ID.
Use `src/ts/server/pendingMutationOutbox.test.ts` and
`src/ts/server/pendingMutationOutbox.crossTab.test.ts`.

## 2c: Decouple Cache Maintenance from Reads (F04)

Owners: `src/ts/server/resourceCache.ts`, `src/ts/server/resourceReads.ts`,
`src/ts/server/hydrationReads.ts`.
Read the [cache protocol](../../../../docs/structure/server-resources-and-bridges.md#cache-protocol).

- Keep authenticated hash confirmation and value validation on the resource
  read path. Separate cache writes from global eviction scheduling; determine
  whether writes also need to be detached from delivery using the baseline.
  Callers must stop awaiting any promise that includes global maintenance;
  coalescing pruning while leaving it inside that promise is insufficient.
- Coalesce pruning per burst or maintain incremental retention metadata with
  explicit eventual completion. Bound temporary growth and guarantee maintenance
  even under continuous traffic; neither one prune per response nor indefinite
  deferral is acceptable.
- Fence pending work against cache clear, logout/writer scope changes, lineage
  replacement, database close/version changes, and rejected writes. Old work
  must not repopulate a cleared or differently scoped cache. Use a cache generation
  or equivalent fence before reopening/writing and before pruning: resetting the
  write chain does not cancel its previous operations. Test clearing the cache
  while an old write is suspended at each relevant asynchronous boundary.
- Preserve caller ownership of returned objects: delayed persistence must not
  store a subsequently mutated projection. Account for any necessary copy.

Exit: a validated resource can resolve while pruning is deliberately held;
bursts coalesce enumeration work; retention limits converge; quota/unavailable
IndexedDB and stale writes cannot corrupt resource results or hang recovery.
Use `src/ts/server/resourceCache.test.ts`,
`src/ts/server/resourceReads.svelte-node.test.ts`, and the targeted startup
cache/recovery browser specs selected from the current test guide.

## 2d: Selected-Locale Loading (F06)

Owners: `src/lang/index.ts`, `src/main.ts`,
`src/ts/storage/database.svelte.ts`, and their bootstrap/settings/resource callers.
Read [localization](../../../../src/docs/svelte-ui.md#localization).

- Keep a reliable synchronous fallback for entry/preload failures; load the
  selected locale through a memoized dynamic import after its selection is known.
- Update synchronous `getLanguageForCode`/`changeLanguage` consumers deliberately.
  Inventory consumers of the live `language` binding and define the fallback/
  readiness contract during loading, including synchronous database/resource
  application. Use type-only imports for language typing where needed; no
  consumer or barrel may pull all packs back into the eager graph.
- Preserve English fallback merging, startup readiness, runtime switching,
  language-code aliases, stale async selection ordering, and retryable chunk
  failure. Mark a locale applied only after successful loading/application, so
  the current last-applied optimization cannot suppress a retry. Avoid a
  waterfall that erases the transfer benefit for a non-English
  user's first usable screen.

Exit: unused packs are absent from the initial closure and are not immediately
prefetched indiscriminately; English and non-English startup/switching behave
correctly. Compare both initial and immediate-startup closures plus browser
readiness against Phase 1. Do not claim the entire old language chunk as savings.
Use `src/lang/index.test.ts`, `src/ts/setting/languageSettingsData.test.ts`,
`pnpm build:initial-preload`, and an exact startup browser spec.

## Phase Verification and Rollback

For each slice run focused behavioral tests and its cost probe. At completed
implementation boundaries run `pnpm test:agent`; run the exact performance or
browser specs required by that slice separately. Update the owning current
guides and run `pnpm check:docs`.

Keep each slice independently revertible without changing stored outbox
formats. If a format change becomes necessary, split out its migration and
rollback contract before proceeding. Retain the existing cache invalidation,
receipt, and projection fences throughout all four slices.
