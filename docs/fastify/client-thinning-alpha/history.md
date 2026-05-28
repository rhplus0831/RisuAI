# History

Date: 2026-05-28

Resolved alpha findings, verification-ladder results, and closeout notes live
here. The live task list is [`open-findings.md`](./open-findings.md).

## Initial alpha handoff

Opened on 2026-05-28 from the cross-verification of:

- [`../../audit-codex.md`](../../audit-codex.md)
- [`../../audit-claude.md`](../../audit-claude.md)

Bucket 1 closed AF1 on 2026-05-28. Bucket 2 closed AF2 on 2026-05-28. Bucket 3
closed AF3 on 2026-05-28.

## Resolved findings

### Bucket 1 - Root create id validation + audit expansion

Resolved: **AF1 / AEC1**.

Public command-path root create helpers now require caller-supplied durable ids
for characters, presets, personas, translator presets, loadouts, modules, chats,
chat folders, and lorebooks. Legacy/default repair paths use separate repair
helpers, so import/bootstrap normalization can still mint ids for malformed
persisted data without weakening the command contract.

Regression proof:

- `server/fastify/__tests__/commands.test.ts` rejects missing-id POSTs for every
  public root create route and confirms the revision is not bumped.
- `util/client-thinning-audit.ts` now checks the root create helpers for
  `randomUUID()` reintroduction.

### Bucket 2 - JSON import/export current-shape parity

Resolved: **AF2 / AEC2 partial**.

JSON import, multipart `.risu` import, bootstrap-normalized state, and block
export now share the same current-shape repair boundary for the export-required
top-level resource families. Accepted imports always persist `characters`,
`botPresets`, `modules`, `loadouts`, and `plugins` as arrays plus
`pluginCustomStorage` as an object. Older persisted minimal databases are also
normalized before block export.

Regression proof:

- `server/fastify/__tests__/risuSaveImportRoute.test.ts` covers minimal
  `{ database: { v: 1 } }`, every missing export-required family, malformed
  resource-family repair, and immediate block export after import.
- `server/fastify/__tests__/risuSaveExportRoute.test.ts` covers block export of
  an older persisted minimal database through the same normalizer.
- `util/client-thinning-audit.ts` now checks that import normalization covers
  every resource family required by block export.

### Bucket 3 - Preset image validation + walker audit parity

Resolved: **AF3 / AEC3**.

Preset create and patch command paths now validate `botPresets[*].image` with
the same optional server-asset semantics used by other walked optional asset
references. Clear values remain accepted (`null`, `""`, and `"-"`), while
malformed strings and valid-looking missing asset ids are rejected before
persistence.

Regression proof:

- `server/fastify/__tests__/commands.test.ts` covers valid preset image create
  and patch, clear-value patching, malformed create/patch rejection, missing
  asset create/patch rejection, and no revision bump on rejected preset image
  writes.
- `util/client-thinning-audit.ts` now checks that the asset walker field
  `database.botPresets[*].image` has matching preset command validation.

## Verification results

Bucket 1 verifier result:

- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: passed
  (71 tests).
- `pnpm client-thinning:audit`: passed.

Bucket 2 verifier result:

- `pnpm api:test server/fastify/__tests__/risuSaveImportRoute.test.ts -- --run`:
  passed (17 tests).
- `pnpm api:test server/fastify/__tests__/risuSaveExportRoute.test.ts -- --run`:
  passed (7 tests).
- `pnpm client-thinning:audit`: passed.

Bucket 3 verifier result:

- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: passed
  (73 tests).
- `pnpm client-thinning:audit`: passed.

Initial verifier result:

- `pnpm client-thinning:audit`: passed.

That initial pass was not sufficient for alpha closeout because AF1, AF2, and
AF3 were audit blind spots. AF1 and AF2 now have invariant-audit coverage; AF3
remains open.

## Archived baseline

The baseline client-thinning workstream remains in
[`../client-thinning/`](../client-thinning/). Treat that directory as historical
context for the original EC1-EC7 contract. This alpha directory is the current
handoff for the newly verified follow-up findings.
