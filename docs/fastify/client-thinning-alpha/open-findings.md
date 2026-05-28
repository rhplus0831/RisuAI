# Open Findings

Date: 2026-05-28

The findings below are the current alpha task list. They were cross-verified
against the codebase from [`../../audit-codex.md`](../../audit-codex.md) and
[`../../audit-claude.md`](../../audit-claude.md); see
[`audit.md`](./audit.md).

## Summary

| Finding | Severity | Criterion | Status | Bucket |
| --- | --- | --- | --- | --- |
| AF2 | High | AEC2 | Open | 2 |
| AF3 | Medium | AEC3 | Open | 3 |
| AF4 | Medium | AEC2 | Open | 4 |
| AF5 | Medium | AEC4 | Open | 5 |
| AF6 | Low | AEC5 | Open | 6 |
| AF7 | Low | AEC5 | Open | 6 |
| AF8 | Low | AEC6 | Open | 7 |
| AF9 | Low | AEC7 | Open | 8 |
| AF10 | Low | AEC6 | Open | 7 |

## AF2 - JSON import can create state that block export rejects

Severity: **High**

Source: `docs/audit-codex.md` P2.

Evidence:

- JSON import calls `normalizeRisuSaveImportDatabase` at
  `server/fastify/src/routes/save.ts:66-68`.
- The normalizer conditionally creates only some top-level collections at
  `server/fastify/src/risuSave/importSnapshot.ts:155-194`.
- The route test accepts `{ database: { v: 1 } }` at
  `server/fastify/__tests__/risuSaveImportRoute.test.ts:94-101`.
- Block export requires arrays such as `database.botPresets`,
  `database.modules`, and `database.loadouts` at
  `server/fastify/src/risuSave/exportSnapshot.ts:62-78`.

Impact:

An accepted JSON import can persist a database shape that later fails block
export validation. This contradicts the import current-shape criterion and
invalidates any PASS claim that only checks duplicate/missing child ids.

Done when:

- Minimal accepted JSON imports either normalize to an exportable current shape
  or return 400 before persistence.
- Import and export tests cover the minimal shape and at least one missing-family
  case for every export-required collection.

## AF3 - Preset image is walked as an asset reference but not validated

Severity: **Medium**

Source: `docs/audit-claude.md` F-B.

Evidence:

- The asset walker includes `database.botPresets[*].image` at
  `server/fastify/src/risuSave/assetReferences.ts:73-77`.
- `createPresetRecord` validates only `name` at
  `server/fastify/src/commands/presets.ts:163-170`.
- Preset patch accepts raw JSON and merges it at
  `server/fastify/src/routes/commands.ts:1058-1078`.
- Invalid non-asset strings are ignored by the walker at
  `server/fastify/src/risuSave/assetReferences.ts:146-148`, but valid-looking
  missing asset ids are reported as missing.

Impact:

Preset commands can persist asset references that export/bundle tooling later
treats as missing. The EC7 walker-vs-validator audit currently misses this
top-level field.

Done when:

- Preset create and patch validate `image` with the same optional server-asset
  semantics used for other walked optional refs.
- The audit enumerates all top-level walker fields, not only character and
  character-order fields.

## AF4 - ROOT_COMPONENT import can overwrite reserved top-level state

Severity: **Medium**

Source: lower-confidence edge from `docs/audit-codex.md`, confirmed during
cross-verification.

Evidence:

- `.risu` import allows arbitrary top-level assignment at
  `server/fastify/src/risuSave/importSnapshot.ts:133-139`.
- Block export later requires specific shapes at
  `server/fastify/src/risuSave/exportSnapshot.ts:62-93`.

Impact:

Even if normal resource blocks are normalized, a ROOT_COMPONENT block can
overwrite reserved resource-family keys such as `characters` into a shape that
export rejects.

Done when:

- ROOT_COMPONENT import rejects or ignores reserved resource-family keys that
  must be owned by normalized resource block handling.
- Tests cover a reserved-key overwrite attempt and prove export remains valid.

## AF5 - Chat folder ids are scoped on create but global on patch/delete

Severity: **Medium**

Source: `docs/audit-codex.md` P2.

Evidence:

- Creation checks duplicate folder ids only within the target character at
  `server/fastify/src/routes/commands.ts:2669-2674`.
- Patch/delete routes identify only `:folderId` at
  `server/fastify/src/routes/commands.ts:2697-2712` and
  `server/fastify/src/routes/commands.ts:2740-2755`.
- The resolver returns the first matching folder across characters at
  `server/fastify/src/commands/chats.ts:286-299`.

Impact:

Two characters can contain the same folder id, but later patch/delete commands
cannot disambiguate them and may mutate the wrong character's folder.

Done when:

- The command contract has one folder-id scope: either globally unique ids or
  parent-scoped patch/delete addressing.
- Tests cover duplicate folder ids across characters and patch/delete behavior.

## AF6 - Chat module references accept arbitrary ids

Severity: **Low**

Source: `docs/audit-codex.md` P3.

Evidence:

- Chat validation only requires `modules` to be an array of nonempty strings at
  `server/fastify/src/commands/chats.ts:443-449`.
- Active module resolution ignores unmatched ids at
  `server/fastify/src/prompt/modules.ts:46-63`.
- Module deletion cleanup treats the values as durable references at
  `server/fastify/src/commands/modules.ts:166-175`.

Impact:

Command paths can persist nonexistent module ids. Runtime impact is limited
because prompt assembly ignores missing modules, but durable reference semantics
are unclear.

Done when:

- `chat.modules` is either validated against existing modules on command writes
  or explicitly documented/tested as a tolerant unresolved reference list.

## AF7 - MCP module command/link boundary is unclear

Severity: **Low**

Source: lower-confidence edge from `docs/audit-codex.md`, confirmed as unclear.

Evidence:

- Normal module commands exclude MCP rows at
  `server/fastify/src/commands/modules.ts:115-116`.
- Character module link validation allows all module ids at
  `server/fastify/src/commands/modules.ts:149-157`.

Impact:

The system has two module ownership classes but no documented rule for whether
MCP module ids may be linked through normal character/chat module commands.

Done when:

- MCP module ids are either accepted with explicit semantics and tests or
  rejected from normal module-link commands with tests.

## AF8 - Asset re-upload does not heal missing blob files

Severity: **Low**

Source: lower-confidence edge from `docs/audit-codex.md`, conditionally
confirmed.

Evidence:

- `addAsset` returns existing metadata without rewriting the file at
  `server/fastify/src/repository.ts:151-155`.
- Asset GET 404s if the blob is absent at
  `server/fastify/src/routes/assets.ts:78-86`.

Impact:

If metadata exists but the blob was lost, re-uploading the same asset id can
leave the asset unreadable.

Done when:

- Re-upload semantics are defined and tested. Prefer healing the blob when
  metadata exists but the file is missing.

## AF9 - Client-thinning closeout docs conflict

Severity: **Low**

Source: `docs/audit-codex.md` P3.

Evidence:

- `docs/fastify/client-thinning/README.md:64` says EC1-EC7 are closed.
- `docs/fastify/client-thinning/final-audit.md:10-11` says EC1-EC7 remain open.
- `docs/fastify/status.md:17-23` carries older verification status.

Impact:

Future reviewers and task agents can choose the wrong closeout state.

Done when:

- This alpha directory records the current open state.
- Historical docs are either reconciled or explicitly marked as historical
  snapshots after alpha closeout.

## AF10 - Optional asset-clear paths lack regression tests

Severity: **Low**

Source: `docs/audit-claude.md` F-C.

Evidence:

- Optional clears are allowed by `server/fastify/src/commands/assets.ts:12-17`.
- Tests cover malformed/missing audio refs at
  `server/fastify/__tests__/commands.test.ts:5218-5294`, but not `null`, `""`,
  or `"-"`.

Impact:

No current behavior violation was found, but regression coverage is incomplete
for the clear values the validator intentionally accepts.

Done when:

- Character audio asset create/patch tests cover `null`, `""`, and `"-"` for
  `vits.files.*` and `gptSoVitsConfig.ref_audio_data.assetId`.
