# History

Date: 2026-05-28

Resolved alpha findings, verification-ladder results, and closeout notes live
here. The live task list is [`open-findings.md`](./open-findings.md).

## Initial alpha handoff

Opened on 2026-05-28 from the cross-verification of:

- [`../../audit-codex.md`](../../audit-codex.md)
- [`../../audit-claude.md`](../../audit-claude.md)

Bucket 1 closed AF1 on 2026-05-28. Bucket 2 closed AF2 on 2026-05-28. Bucket 3
closed AF3 on 2026-05-28. Bucket 4 closed AF4 on 2026-05-28. Bucket 5 closed
AF5 on 2026-05-28. Bucket 6 closed AF6 and AF7 on 2026-05-28.

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

### Bucket 4 - ROOT_COMPONENT reserved-key guard

Resolved: **AF4 / AEC2**.

RISUSAVE ROOT_COMPONENT blocks now reject block-export-owned resource keys before
they can assign arbitrary top-level database values. The reserved keys are
`characters`, `botPresets`, `modules`, `loadouts`, `plugins`,
`pluginCustomStorage`, and `__directory`. Non-reserved ROOT_COMPONENT fields
continue to import as top-level database fields.

Regression proof:

- `server/fastify/__tests__/risuSaveImportRoute.test.ts` covers successful
  non-reserved ROOT_COMPONENT import, reserved `characters` overwrite rejection,
  no mutation on rejected import, and successful block export after rejection.
- `util/client-thinning-audit.ts` now checks that the ROOT_COMPONENT reserved-key
  set matches block export's resource-key set and that the importer guards the
  assignment path.

### Bucket 5 - Chat folder identity scope

Resolved: **AF5 / AEC4**.

Chat folder ids are now globally unique for command-written state, matching the
public patch/delete route shape that addresses folders by `folderId` alone. The
dedicated folder create route and the fork route's optional folder creation both
reject ids already used by any character. Import/bootstrap repair keeps legacy
state usable by rewriting duplicate folder ids across characters and updating
that character's chat `folderId` references to the rewritten id.

Regression proof:

- `server/fastify/__tests__/commands.test.ts` covers cross-character duplicate
  folder-id rejection, fork-created duplicate rejection, deterministic
  patch/delete targeting, and imported duplicate repair with chat references
  preserved.
- `util/client-thinning-audit.ts` now checks that chat normalization performs a
  global folder-id repair pass and that both command create surfaces use the
  global duplicate guard.

### Bucket 6 - Module reference and MCP boundary semantics

Resolved: **AF6, AF7 / AEC5**.

Normal command-written module reference lists now target existing non-MCP module
rows. Chat create, chat patch, chat fork source patches, forked chat payloads,
and character module relinks reject nonexistent module ids and MCP module ids
before persistence. Module ordering can still include MCP rows because that
command orders the full module collection rather than linking normal
character/chat references.

Regression proof:

- `server/fastify/__tests__/commands.test.ts` covers nonexistent and MCP module
  rejection for `chat.modules`, fork `sourcePatch.modules`, forked chat
  `modules`, and character module relinks, with no revision bump on rejected
  writes.
- `util/client-thinning-audit.ts` now checks that normal module-link validation
  excludes MCP rows, rejects unresolved ids, and is wired into the command
  surfaces that persist normal module reference lists.

### Bucket 7 - Asset blob healing + optional clear tests

Resolved: **AF8, AF10 / AEC6**.

Asset re-upload now heals a persisted asset metadata row whose blob file is
missing. `addAsset` keeps the existing stable asset id and metadata response but
rewrites the expected blob path when the upload bytes hash to an existing asset
row and the file is absent.

Optional character audio clear values are now covered as intentional command API
behavior. `null`, `""`, and `"-"` are accepted for both `vits.files.*` and
`gptSoVitsConfig.ref_audio_data.assetId` on character create and patch paths.

Regression proof:

- `server/fastify/__tests__/assets.test.ts` covers upload, missing blob 404,
  same-id re-upload healing, and successful GET of the restored blob.
- `server/fastify/__tests__/commands.test.ts` covers the `null`, `""`, and
  `"-"` clear values for character audio refs on create and patch.
- `util/client-thinning-audit.ts` now checks that `addAsset` heals missing
  blobs for existing metadata and that optional server asset refs preserve the
  documented clear-value semantics.

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

Bucket 4 verifier result:

- `pnpm api:test server/fastify/__tests__/risuSaveImportRoute.test.ts -- --run`:
  passed (19 tests).
- `pnpm client-thinning:audit`: passed.

Bucket 5 verifier result:

- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: passed
  (75 tests).
- `pnpm client-thinning:audit`: passed.

Bucket 6 verifier result:

- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: passed
  (76 tests).
- `pnpm test src/ts/server/commands.test.ts -- --run`: passed (36 tests).
- `pnpm client-thinning:audit`: passed.

Bucket 7 verifier result:

- `pnpm api:test server/fastify/__tests__/assets.test.ts -- --run`: passed
  (16 tests).
- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: passed
  (77 tests).
- `pnpm client-thinning:audit`: passed.

Initial verifier result:

- `pnpm client-thinning:audit`: passed.

That initial pass was not sufficient for alpha closeout because AF1, AF2, AF3,
AF4, AF5, AF6, AF7, AF8, and AF10 were audit or regression blind spots. AF1
through AF8 and AF10 now have focused regression coverage, and the invariant
audit covers each bug class that was appropriate for repeatable structural
checking.

## Archived baseline

The baseline client-thinning workstream remains in
[`../client-thinning/`](../client-thinning/). Treat that directory as historical
context for the original EC1-EC7 contract. This alpha directory is the current
handoff for the newly verified follow-up findings.
