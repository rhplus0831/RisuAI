# Alpha Cross-Audit Verification

Date: 2026-05-28

This audit seeds the alpha task-agent workstream. It consolidates the verified
findings from [`../../audit-codex.md`](../../audit-codex.md) and
[`../../audit-claude.md`](../../audit-claude.md).

Verification was read-only. The verifier ran `pnpm client-thinning:audit`; it
passed, which is itself evidence that several alpha findings are audit-script
blind spots.

## Verified findings

| Finding | Source | Verdict | Severity | Alpha criterion |
| --- | --- | --- | --- | --- |
| AF1 | Codex P1 / Claude F-A | Confirmed duplicate | High | AEC1 |
| AF2 | Codex P2 | Confirmed | High | AEC2 |
| AF3 | Claude F-B | Partially confirmed | Medium | AEC3 |
| AF4 | Codex lower-confidence edge | Confirmed | Medium | AEC2 |
| AF5 | Codex P2 | Confirmed | Medium | AEC4 |
| AF6 | Codex P3 | Confirmed | Low | AEC5 |
| AF7 | Codex lower-confidence edge | Unclear, real boundary gap | Low | AEC5 |
| AF8 | Codex lower-confidence edge | Conditionally confirmed | Low | AEC6 |
| AF9 | Codex P3 | Confirmed | Low | AEC7 |
| AF10 | Claude F-C | Confirmed test gap | Low | AEC6 |

## Key evidence

### AF1 - Command create helpers mint ids

Confirmed in public command helpers such as:

- `server/fastify/src/commands/characters.ts:117`
- `server/fastify/src/commands/presets.ts:165`
- `server/fastify/src/commands/personas.ts:62`
- `server/fastify/src/commands/translatorPresets.ts:73`
- `server/fastify/src/commands/loadouts.ts:60`
- `server/fastify/src/commands/modules.ts:75`
- `server/fastify/src/commands/chats.ts:118`
- `server/fastify/src/commands/chats.ts:129`
- `server/fastify/src/commands/lorebooks.ts:139`

Public routes call these helpers from `server/fastify/src/routes/commands.ts`
around `:1024`, `:1548`, `:1806`, `:1996`, `:2184`, `:2375`, `:2662`, `:3125`,
and `:3420`. The audit whitelist only checks child validators in
`util/client-thinning-audit.ts:222-227`.

### AF2 - JSON import/export mismatch

JSON import calls `normalizeRisuSaveImportDatabase` in
`server/fastify/src/routes/save.ts:66-68`, but the normalizer conditionally
creates top-level collections in
`server/fastify/src/risuSave/importSnapshot.ts:155-194`. A route test accepts
`{ database: { v: 1 } }` in
`server/fastify/__tests__/risuSaveImportRoute.test.ts:94-101`, while block
export requires arrays such as `botPresets`, `modules`, and `loadouts` in
`server/fastify/src/risuSave/exportSnapshot.ts:62-78`.

### AF3 - Preset image walker drift

The asset walker includes `database.botPresets[*].image` in
`server/fastify/src/risuSave/assetReferences.ts:73-77`. `createPresetRecord`
validates only `name` in `server/fastify/src/commands/presets.ts:163-170`, and
preset patch merges raw JSON in `server/fastify/src/routes/commands.ts:1058-1078`.

The finding is partially confirmed because malformed non-asset strings are
accepted but ignored by the walker at
`server/fastify/src/risuSave/assetReferences.ts:146-148`; valid-looking missing
asset ids are reported as missing.

### AF4 - ROOT_COMPONENT overwrite

`.risu` import allows arbitrary top-level assignment in
`server/fastify/src/risuSave/importSnapshot.ts:133-139`. Export later requires
specific shapes in `server/fastify/src/risuSave/exportSnapshot.ts:62-93`.

### AF5 - Chat folder scope mismatch

Creation checks duplicates only within a character in
`server/fastify/src/routes/commands.ts:2669-2674`. Patch/delete identify only
`:folderId` at `server/fastify/src/routes/commands.ts:2697-2712` and
`server/fastify/src/routes/commands.ts:2740-2755`. The resolver returns the
first match across characters in `server/fastify/src/commands/chats.ts:286-299`.

### AF6 - Chat module references accept arbitrary ids

`chat.modules` validation only requires nonempty strings in
`server/fastify/src/commands/chats.ts:443-449`. Active module resolution ignores
unmatched ids in `server/fastify/src/prompt/modules.ts:46-63`, while deletion
cleanup treats them as durable references in
`server/fastify/src/commands/modules.ts:166-175`.

### AF7 - MCP module boundary

Normal module commands exclude MCP rows in
`server/fastify/src/commands/modules.ts:115-116`, while character module link
validation allows all module ids in
`server/fastify/src/commands/modules.ts:149-157`.

### AF8 - Asset re-upload missing blob

`addAsset` returns existing metadata without rewriting the file in
`server/fastify/src/repository.ts:151-155`. Asset GET 404s if the blob is absent
in `server/fastify/src/routes/assets.ts:78-86`.

### AF9 - Docs conflict

`docs/fastify/client-thinning/README.md:64` says EC1-EC7 are closed, while
`docs/fastify/client-thinning/final-audit.md:10-11` says EC1-EC7 remain open.
`docs/fastify/status.md:17-23` has older verification status.

### AF10 - Optional clear test gap

Optional asset clears are allowed by `server/fastify/src/commands/assets.ts:12-17`.
Existing tests cover malformed/missing audio refs around
`server/fastify/__tests__/commands.test.ts:5218-5294`, but not `null`, `""`, or
`"-"`.

## Overlaps

- Codex P1 and Claude F-A are the same stable-id/audit-whitelist issue.
- Claude EC7 partial has the same root cause as AF1 and AF3: audit coverage is
  narrower than the documented invariants.
- Claude EC3 PASS conflicts with AF2 and should not be used as the current alpha
  state.

## Prioritized audit list

1. High: public command create helpers still mint ids; audit misses them.
2. High: JSON import accepts minimal/export-invalid state.
3. Medium: preset `image` is walked as an asset ref but not validated.
4. Medium: ROOT_COMPONENT can overwrite reserved top-level state.
5. Medium: chat folder patch/delete are global while create allows per-character
   duplicate ids.
6. Low: `chat.modules` accepts unresolved ids.
7. Low: MCP module command/link semantics are inconsistent or undocumented.
8. Low: asset re-upload does not heal a missing blob.
9. Low: closeout/status docs conflict.
10. Low: optional asset-clear paths lack regression tests.
