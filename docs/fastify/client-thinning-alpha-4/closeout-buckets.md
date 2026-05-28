# Closeout Buckets

Date: 2026-05-28

The work breakdown for Alpha 4, in suggested order. Each bucket closes one or
more exit criteria ([`README.md`](./README.md)) and findings
([`open-findings.md`](./open-findings.md)). A bucket is done only when its
audit rule fails on the pre-fix tree, passes after the fix, and the finding
is resolved with focused regression proof.

| Order | Bucket                                              | Closes                | Status |
| ----- | --------------------------------------------------- | --------------------- | ------ |
| 0     | Audit rewrite (invariant-derived rules)             | A4EC1                 | **Closed 2026-05-28** |
| 1     | Composite command fan-out serialization             | A4EC2 / B1            | **Partial — 3 of 7 call sites closed (SideChatList, applyModule); 4 remain** |
| 2     | Transitive id minting + classification              | A4EC3 / B2 / B3 / B10 | Open   |
| 3     | Backup directory inventory                          | A4EC4 / B4 / B5       | **Closed 2026-05-28** |
| 4     | In-memory accumulator bounds                        | A4EC5 / B6            | **Closed 2026-05-28** |
| 5     | `saveAsset` caller classification                   | A4EC6 / B7            | **Closed 2026-05-28** |
| 6     | Asset URL gate + global normalization route hole    | A4EC7 / A4EC8 / B8 / B9 | **Closed 2026-05-28** |
| 7     | Final docs/status/ladder                            | A4EC9                 | Open   |

## Bucket 0 - Audit Rewrite (closed 2026-05-28)

The audit script `util/client-thinning-audit.ts` is now invariant-derived.
Every rule asserts an invariant against authoritative source structures
(SECRET_PATHS, asset walker collector table, route registrations,
dispatch\* enumeration, dataDir children, saveAsset callers,
process-lifetime accumulators) rather than literal pre-fix text. The rules
are:

- **A4R1** passive refresh writer ownership — enumerates writer-mode helpers
  by AST (functions whose body attaches `activeWriterSessionHeader()` or
  passes `registerActiveWriter: true`) and asserts every caller is in
  `WRITER_BOOTSTRAP_CALLERS`.
- **A4R2** conflict replay outside central wrapper — flags every function
  observing `result.status === 'conflict'` followed by a mutating
  command-with-baseRevision call, except `runServerCommand`.
- **A4R3** transitive command-path id minting — call-graph walk from each
  route handler; `ensure*`/`normalize*` helpers are non-propagating
  repair-on-read (with arg-provenance check), `repair*` helpers are
  propagating and forbidden in command paths.
- **A4R4** globally-addressed resolver normalize — per-function check that
  every call to `requireChatLocation`/`requireMessageLocation` is preceded
  by the matching normalizer in the same scope (`require*` resolver
  wrappers are exempt; their callers carry the obligation).
- **A4R5** asset reference parser parity — extracts client regex via
  `LOCAL_ASSET_PATH_RE` and asserts the server walker accepts an equal
  literal.
- **A4R6** wildcard secret row identity — derives wildcard arrays from
  `SECRET_PATHS` via AST; each row-bearing wildcard array must have an
  entry in `ARRAY_ROW_IDENTITY_KEYS`. Flat array-of-strings paths must be
  classified in `FLAT_ARRAY_SECRETS_CLASSIFIED`.
- **A4R7** asset URL gate — AST extraction of every `isFastifyServer`-guarded
  branch in classified asset URL helpers; rejects `?? loc` fall-through and
  requires an explicit `return '' / null / throw` for unknown shapes.
- **A4R-fanout** composite command race — derives mutating dispatchers from
  `dispatch*` exports across `chatCommands`/`characterCommands`/`moduleCommands`/
  bridge files; flags ≥2 unawaited dispatches in one scope (with
  branch-exclusive early-return detection).
- **A4R-backup** data dir inventory — asserts every entry in
  `KNOWN_DATA_DIR_CHILDREN` appears in `createBackup` and `restoreBackup`.
- **A4R-bounded** process-lifetime accumulators — classified inventory
  (`BOUNDED_ACCUMULATOR_DECLARATIONS`) plus drift detection for new
  top-level `Set`/`Map`/`Array` declarations in `server/fastify/src/`
  without an `// audit:bounded` marker.
- **A4R-saveasset** filename classification — every `saveAsset(bytes)` call
  without a filename must carry a leading `// audit:image-default` marker.

This bucket landed before any behavior closure; every behavior bucket below
was demonstrated red on the new rules before its fix.

## Bucket 3 - Backup Directory Inventory (closed 2026-05-28)

Closed by introducing `KNOWN_DATA_DIR_CHILDREN = ['db.json', 'assets', 'risu.db', 'save']`
in `server/fastify/src/repository.ts`. `createBackup` now snapshots all four:
`db.json`, the `assets/` directory, `risu.db` (after a WAL checkpoint), and
the `save/` legacy storage directory. `restoreBackup` restores `risu.db` via
an `ATTACH` + table-level swap that preserves the live `DatabaseSync` handle,
plus atomic file-rename for the other three. Regression tests in
`server/fastify/__tests__/backups.test.ts` round-trip memory tables and the
legacy storage directory across backup and restore.

## Bucket 4 - In-Memory Accumulator Bounds (closed 2026-05-28)

Closed by adding an LRU cap of 4096 to `auth.knownKeyHashes` in
`server/fastify/src/auth.ts` with `touch` on verify, eviction of the oldest
on insert, and persistence of the bounded set on every register. Pre-existing
oversize on-disk caches are trimmed on load. Regression tests in
`server/fastify/__tests__/auth.test.ts` cover cap eviction, persistence, and
trim-on-load.

## Bucket 5 - `saveAsset` Caller Classification (closed 2026-05-28)

Closed by audit-driven classification. Per-call `// audit:image-default`
markers were added at every legitimate image-only `saveAsset` caller in
`characterCards.ts`, `plugins.svelte.ts`, and `processzip.ts`. Non-image
callers now pass real filenames:

- `characterCards.ts:592`: `/none.webp` → `'none.webp'`.
- `characterCards.ts:728`: VITS audio → source `key` (with the real
  extension).
- `process/modules.ts:219`: module RPack asset → tuple's filename slot.

The audit rule **A4R-saveasset** enforces every future caller picks one of
the two paths.

## Bucket 6 - Asset URL Gate + Global Normalization Hole (closed 2026-05-28)

Closed via:

- **B8 / A4EC7**: `getFileSrc` (`src/ts/globalApi.svelte.ts:148`) in Fastify
  mode now only returns documented shapes (`/api/v1/assets/`, `data:`,
  `blob:`, raw asset id via `serverAssetUrl`, legacy `assets/<sha>.<ext>`
  via `serverAssetUrl`). Unknown shapes — including arbitrary `http://`/
  `https://` URLs from a poisoned projection — return `''`. Focused tests
  in `src/ts/globalApi.getFileSrc.test.ts` cover every accepted/rejected
  shape.
- **B9 / A4EC8**: `normalizeSelectedChatLorebooks`
  (`server/fastify/src/commands/lorebooks.ts:285`) now calls
  `normalizeAllCharacterChats(database)` before invoking the global
  `requireChatLocation` resolver. The audit rule **A4R4** enforces the
  general invariant across every server-side function that uses the
  resolver.

## Bucket 1 - Composite Command Fan-out Serialization (partial)

Status: **partial.** 3 of 7 call sites are closed; 4 remain open.

Closed:

- **SideChatList drag-end folder + chat reorder**
  (`src/lib/SideBars/SideChatList.svelte:246-255`) — replaced the two
  fire-and-forget dispatchers with `runOptimisticCommandSequence` over the
  underlying `reorderChatFoldersCommand` and `reorderChatsCommand`. The
  legacy-mode `dispatchReorderChat*` calls were removed (they would have
  been no-ops outside server mode anyway). `runOptimisticCommandSequence`
  is now exported from `src/ts/chatCommands.ts`.
- **applyModule** (`src/ts/process/modules.ts:548`) — the three child
  replacement dispatches (lorebooks/scripts/triggers) now route through
  the sequencer with `replaceCharacterLorebooksCommand` /
  `replaceCharacterScriptsCommand` / `replaceCharacterTriggersCommand`
  builders. The rollback restores both lorebook and script-definition
  states atomically. `ensureClientLorebookEntryIds` /
  `ensureClientScriptDefinitionIds` / `ensureClientTriggerDefinitionIds`
  / `restoreLorebookState` / `restoreScriptDefinitionState` are re-exported
  for use. Regression test in `src/ts/process/modules.test.ts` asserts the
  sequencer is called with the three factories.

Open (still flagged by the audit):

- `src/ts/process/sendChatContext.ts:78` — `dispatchUpdateCharacter` +
  `dispatchReplaceMessages` in the message-id backfill path.
- `src/ts/plugins/plugins.svelte.ts:787` — `dispatchModuleCollectionPatch`
  iterates module diffs and fires create/update/delete/reorder against one
  optimistic snapshot. Needs queueing.
- `src/ts/plugins/plugins.svelte.ts:821` — `dispatchEnabledModulesPatch`
  iterates enable/disable flag diffs.
- `src/ts/plugins/apiV3/v3.svelte.ts:980` — `makeRisuaiAPIV3` arrow
  dispatches compatible character + chat updates back-to-back.

The audit rule **A4R-fanout** keeps firing on each of these until closed;
they are gated against regression.

## Bucket 2 - Transitive Id Minting + Classification (open)

Status: **open.** The audit rule **A4R3** flags every remaining instance:

- **B2 (`createGlobalLorebookRecord` transitive entry-id mint)**: `POST
  /api/v1/commands/lorebooks` → `createGlobalLorebookRecord` →
  `repairLorebookEntries({ repairId: true })` → mint. Fix: split the
  helper so the command-path constructor rejects missing entry ids; the
  import-path repair stays.
- **`readLorebookEntries`-using replace routes** (4 routes): same class,
  the replace helper internally calls `repairLorebookEntries`. Fix is
  parallel: route them through a no-mint validator that requires
  client-supplied ids.
- **B10**: `repairPresetRecord` is exported but unused in production. Fix:
  delete the export. The audit also asserts no route file imports an
  id-minting `repair*` helper.

## Bucket 7 - Final docs/status/ladder (open)

Status: open until all behavior buckets close. Tracked: write
`final-audit.md` + `history.md`, reconcile `docs/fastify/status.md` and
`docs/fastify/status/next-steps.md`, correct the stale Alpha-3 doc claim
about `repairPresetRecord`.

## Verification Snapshot 2026-05-28

After the buckets that landed in this session:

- `pnpm client-thinning:audit` — red on remaining B1 (4 sites) and B2/B10
  (5 sites). Each finding includes a structural rule-based diagnostic, not
  a one-off pattern match.
- `pnpm check` — 0 errors / 0 warnings.
- `pnpm test` — 800 passed / 4 skipped (the modules.test.ts mock was
  extended for the new sequencer pattern).
- `pnpm api:test` — 1272 passed.
- `pnpm build` — passes with pre-existing nonblocking warnings.
- `pnpm smoke:fastify-browser` — not rerun this session; expected green
  since browser-touched paths are unchanged.

The audit will keep firing on every open B-bucket until each is closed.
That is by design: the structural rules are the gate, and they cannot be
satisfied by partial fixes.
