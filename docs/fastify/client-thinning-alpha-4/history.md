# Alpha 4 History

Date: 2026-05-28

This file records Alpha 4 findings as buckets close. Alpha 4 is closed as
of 2026-05-28; the final verdict and shared verification ladder are
recorded in [`final-audit.md`](./final-audit.md).

## Bucket 0 - Audit Rewrite (A4EC1)

Status: **Closed 2026-05-28.**

Bucket: 0 - Invariant-derived audit script.

Resolution:

- `util/client-thinning-audit.ts` was rewritten so each rule asserts an
  invariant against authoritative source structures: `SECRET_PATHS`, the
  asset-walker collector table, route registrations, `dispatch*`
  enumerations from `chatCommands`/`characterCommands`/`moduleCommands`
  plus the bridge files, `dataDir` children, `saveAsset` callers, and
  process-lifetime accumulators.
- Every R-rule now explains the invariant it enforces and fails on the
  pre-fix tree before passing after the fix.

Bucket 0 landed first so every subsequent behavior bucket could be
demonstrated red on the new rules before its fix.

## Bucket 3 - Backup Directory Inventory (B4 / B5)

Status: **Closed 2026-05-28.**

Bucket: 3 - Backup directory inventory.

Resolution:

- `server/fastify/src/repository.ts` exposes
  `KNOWN_DATA_DIR_CHILDREN = ['db.json', 'assets', 'risu.db', 'save']`.
- `createBackup` snapshots all four entries: `db.json`, the `assets/`
  directory, `risu.db` (after a WAL checkpoint), and `save/` (legacy
  storage).
- `restoreBackup` restores `risu.db` via an `ATTACH` + table-level swap
  that preserves the live `DatabaseSync` handle, plus atomic file rename
  for the other three.
- Regression tests in `server/fastify/__tests__/backups.test.ts`
  round-trip memory tables and the legacy storage directory across backup
  and restore.

## Bucket 4 - In-Memory Accumulator Bounds (B6)

Status: **Closed 2026-05-28.**

Bucket: 4 - Bounded process-lifetime accumulators.

Resolution:

- `auth.knownKeyHashes` is now an LRU-capped set (cap 4096) in
  `server/fastify/src/auth.ts`.
- Insertions evict the oldest entry; verifies touch the entry to refresh
  LRU order.
- Persistence writes the bounded set on every register; loading trims any
  pre-existing oversize on-disk caches.
- Regression tests in `server/fastify/__tests__/auth.test.ts` cover cap
  eviction, persistence, and trim-on-load.

## Bucket 5 - `saveAsset` Caller Classification (B7)

Status: **Closed 2026-05-28.**

Bucket: 5 - Honest filename metadata at `saveAsset`.

Resolution:

- Per-call `// audit:image-default` markers were added at every
  image-only `saveAsset` caller in `characterCards.ts`,
  `plugins.svelte.ts`, and `processzip.ts`.
- Non-image callers now pass real filenames:
  - `characterCards.ts:592`: `/none.webp` → `'none.webp'`.
  - `characterCards.ts:728`: VITS audio → source `key` (with the real
    extension).
  - `process/modules.ts:219`: module RPack asset → tuple's filename slot.
- A4R-saveasset enforces the contract structurally.

## Bucket 6 - Asset URL Gate + Global Normalization (B8 / B9)

Status: **Closed 2026-05-28.**

Bucket: 6 - Asset URL gate + global normalization.

Resolution:

- `getFileSrc` in Fastify mode (`src/ts/globalApi.svelte.ts`) now returns
  only documented shapes (`/api/v1/assets/`, `data:`, `blob:`, raw asset
  id via `serverAssetUrl`, legacy `assets/<sha>.<ext>` via
  `serverAssetUrl`). Unknown shapes (including arbitrary `http://` /
  `https://` from a poisoned projection) return `''`. Focused tests in
  `src/ts/globalApi.getFileSrc.test.ts` cover every accepted/rejected
  shape.
- `normalizeSelectedChatLorebooks` in
  `server/fastify/src/commands/lorebooks.ts` now calls
  `normalizeAllCharacterChats(database)` before invoking the global
  `requireChatLocation` resolver.
- A4R4 (`every globally-addressed resolver call is preceded by the
  matching normalizer`) enforces the invariant across every server-side
  function that uses the resolver.

## Bucket 1 - Composite Command Fan-out Serialization (B1)

Status: **Closed 2026-05-28.**

Bucket: 1 - Composite command fan-out serialization.

Resolution: split across two passes.

First pass (partial closeout, three sites):

- **SideChatList drag-end folder + chat reorder**
  (`src/lib/SideBars/SideChatList.svelte`) - replaced the two
  fire-and-forget dispatchers with `runOptimisticCommandSequence` over
  the underlying `reorderChatFoldersCommand` and `reorderChatsCommand`.
- **applyModule** (`src/ts/process/modules.ts`) - the three child
  replacement dispatches (lorebooks/scripts/triggers) now route through
  the sequencer with the underlying `replaceCharacter*Command` builders.
- `runOptimisticCommandSequence` is exported from `chatCommands.ts` so
  every caller threads the cached server revision across siblings.

Second pass (final four sites):

- **`setupSendChatContext`** (`src/ts/process/sendChatContext.ts`) - the
  lastInteraction patch and the message-id backfill collect into one
  factory list and run through `runOptimisticCommandSequence`. The
  rollback restores the chat-state snapshot which covers both mutations.
  Regression test in `src/ts/process/__tests__/sendChatContext.test.ts`
  asserts the second command reads the advanced revision.
- **`dispatchModuleCollectionPatch`** (`src/ts/plugins/plugins.svelte.ts`) -
  collects create/update/delete/reorder factories into one sequencer
  call with `restoreModuleState` rollback. Tests in
  `src/ts/plugins/plugins.test.ts` cover the multi-diff sequence and the
  enable/disable variant.
- **`dispatchEnabledModulesPatch`** (same file) - same fix shape with
  `enableModuleCommand` factories.
- **V3 plugin API `setCharacterToIndex` / `setChatToIndex`**
  (`src/ts/plugins/apiV3/v3.svelte.ts`) - new helpers
  `prepareCompatibleCharacterUpdate` / `prepareCompatibleChatUpdate`
  return the factory list each composite would have dispatched. The V3
  call sites now run those factories through
  `runOptimisticCommandSequence` directly, so the audit no longer sees a
  bare `dispatchCompatible*` call inside `makeRisuaiAPIV3`. The existing
  `dispatchCompatibleChatUpdate` is now a thin wrapper over the prepare
  helper.

A4R-fanout enforces the structural invariant: any function scope
containing ≥2 unawaited mutating dispatchers without a sequencer call
fails the audit.

## Bucket 2 - Transitive Id Minting + Dead Export (B2 / B10)

Status: **Closed 2026-05-28.**

Bucket: 2 - Transitive id minting + classification.

Resolution:

- `createLorebookEntryRecord(options.repairId)` was split into two
  helpers in `server/fastify/src/commands/lorebooks.ts`:
  - `validateLorebookEntry` (no minting; throws on missing id).
  - `repairLorebookEntry` (mints on missing id; used only by repair-on-
    read callers).
- `validateLorebookEntries(input, label)` replaces the dead
  `readLorebookEntries` alias and uses `validateLorebookEntry` per
  element.
- `validateGlobalLorebookCreate(input, label)` is the new exported
  command-path constructor for `POST /api/v1/commands/lorebooks`. It
  wraps `validateGlobalLorebookRecord` plus `validateLorebookEntries`
  for nested `data`.
- The five red routes in `server/fastify/src/routes/commands.ts` now
  reach only the no-mint validators:
  - `POST /api/v1/commands/lorebooks` → `validateGlobalLorebookCreate`.
  - `PUT /api/v1/commands/lorebooks/:lorebookId/entries`,
    `/characters/:characterId/lorebooks`,
    `/chats/:chatId/lorebooks`,
    `/modules/:moduleId/lorebooks` → `validateLorebookEntries`.
- A4R3 walks the call graph from each route handler and confirms no
  reachable `randomUUID()`.

B10 closed by deleting the unused `repairPresetRecord` export at
`server/fastify/src/commands/presets.ts`; bootstrap repair-on-read
remains in `ensurePresetCollection`. `rg "repairPresetRecord" server/
src/` is now empty.

The EC4 stable-id audit list was updated to reference the new validator
names (`validateGlobalLorebookCreate` / `validateLorebookEntries`)
because those are the symbols the public routes actually call. The
update is intentional and consistent with the audit-as-contract
philosophy: the audit defends the no-mint validator name that public
routes use, not the original Alpha-3 name.

Regression coverage in `server/fastify/__tests__/commands.test.ts`
exercises missing / duplicate entry ids at every reachable route. The
existing replace + happy-path tests still pass with the new validators.

## Bucket 7 - Final docs / status / ladder (A4EC9)

Status: **Closed 2026-05-28.**

Bucket: 7 - Final docs/status/ladder.

Resolution:

- Wrote [`final-audit.md`](./final-audit.md) with the final Alpha 4
  verdict, criterion status, and verification ladder.
- Wrote this history file.
- Updated [`open-findings.md`](./open-findings.md) and
  [`closeout-buckets.md`](./closeout-buckets.md) to record every B-bucket
  as closed.
- Reconciled `docs/fastify/status.md` and
  `docs/fastify/status/next-steps.md` to point to the Alpha 4 closeout.
- Corrected the stale Alpha-3
  [`open-findings.md`](../client-thinning-alpha-3/open-findings.md) line
  about `repairPresetRecord` to note its Alpha-4 deletion.

Verification:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Alpha 4 has no remaining open buckets after this closeout.
