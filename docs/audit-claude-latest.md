# Phase 9 (Client Thinning) Audit — Claude (Alpha 3 Pass)

Date: 2026-05-28
Auditor: Claude (Opus 4.7, 1M context)
Scope: `docs/fastify/client-thinning-alpha-3/open-findings.md` (A3F1-A3F13)
HEAD at audit: `c42b215f docs: close client thinning alpha 2`

## TL;DR

- All 13 Alpha 3 findings (A3F1-A3F13) are **real**, reproducible from current
  code, and the cited file/line numbers are accurate as of `c42b215f`.
- One scope adjustment: **A3F5 should be narrowed to chats and messages**.
  Folder global-id uniqueness is already enforced by `normalizeGlobalChatFolderIds`
  (audit rule `AEC4 chat folder identity scope`), so the folder portion of the
  finding is stale and should be removed before closeout.
- An independent fan-out sweep found **no additional bug classes** within
  Alpha 3's documented scope. A parallel sub-agent's claim of three new gaps
  (personas, loadouts, translator-presets) is a **false positive** —
  see §4.
- The Phase 9 open-close loop is **caused by audit-script debt, not by missed
  bugs**. Five of the seven Alpha 3 bug classes are direct analogues of Alpha 1
  or Alpha 2 findings in adjacent files. The audit closed each instance
  locally without learning the pattern, so the next reviewer finds it again
  one file over. Closing Alpha 3 by fixing behavior alone will produce an
  Alpha 4. See §5.
- Recommended exit: **land audit rules R1-R7 (§6) *before* the behavior fixes**,
  with each fix gated on a failing-then-passing audit rule.

## 1. Audit method

Six sub-agents were dispatched in parallel; five hit 529 overload and never
ran (`agentId` log in conversation). One Explore sweep finished. To avoid
further blocking, every Alpha 3 finding was then verified by direct file
reads of the cited locations. Where the Explore sweep produced findings, they
were cross-checked against the storage shape before being accepted or
rejected.

Verification covered:

1. Reading the finding text and every cited `file:line`.
2. Opening each cited file and confirming the cited lines contain the
   described code on the current HEAD (no line drift was observed for
   any of A3F1-A3F13).
3. Tracing the data flow end-to-end so the bug is reproducible from code,
   not just from the doc's description.
4. Running `pnpm client-thinning:audit` to confirm the structural audit
   currently passes despite the unfixed bug classes.
5. Reading every check in `util/client-thinning-audit.ts` (1288 lines, 9
   checks at `:1267-1277`) to map A3F1-A3F13 onto current audit coverage.
6. An independent fan-out across non-cited surfaces: passive-read paths,
   conflict retry patterns, id-minting points, globally addressed resources,
   client→server fan-out, direct writers, mutating routes without
   active-writer guard, header-leak paths, secret leak paths, and
   bundle/import/export paths.

## 2. Finding verification matrix

| # | Verdict | Cited lines | Reproduction anchor |
|---|---|---|---|
| **A3F1** Passive bootstrap refresh steals active-writer | ✅ Real | accurate | `server/fastify/src/routes/bootstrap.ts:22-24` unconditionally calls `registerActiveWriterSession`; `activeWriter.ts:13-18` overwrites `state.sessionId` (no first-wins lock); `src/ts/server/bootstrap.ts:33-40` always attaches `activeWriterSessionHeader()`; `src/ts/bootstrap.ts:140-184` invokes `fetchServerBootstrapProjection` from the SSE refresh path. |
| **A3F2** Settings replay 409 with same patch | ✅ Real | accurate | `src/ts/setting/utils.ts:132-148` retries against `result.currentRevision` after a 409 without re-reading server state. Central `runServerCommand` at `src/ts/server/commands.ts:2150-2167` correctly rolls back; settings helper diverges. |
| **A3F3** Preset copy/import mint server ids | ✅ Real | accurate | `src/ts/storage/database.svelte.ts:2215` mints `createClientPresetId()` locally; `copyPresetCommand` body at `src/ts/server/commands.ts:1104-1112` sends only `{name, saveCurrent}` (no id); server route `server/fastify/src/routes/commands.ts:1189-1193` calls `repairPresetRecord({...preset, id: undefined, name})`; `server/fastify/src/commands/presets.ts:191` mints `randomUUID()` for missing id. Client and server diverge on the new id. |
| **A3F4** Last-lorebook delete fallback mints id | ✅ Real | accurate | `server/fastify/src/routes/commands.ts:3227` calls `repairGlobalLorebookRecord({name:'My First LoreBook', data:[]})`; `server/fastify/src/commands/lorebooks.ts:152` mints `randomUUID()` when id missing. Route is public. |
| **A3F5** Global chat/message addressing hits wrong duplicate | ✅ Real (narrow to chats + messages) | accurate | Per-character dedup at `server/fastify/src/commands/chats.ts:59-77`; global resolver `requireChatLocation` at `:291-309` returns first global match; chat create at `server/fastify/src/routes/commands.ts:2395` checks only within target character. Messages have the same shape (`server/fastify/src/commands/messages.ts:141-155`). **Folders are already covered** by `normalizeGlobalChatFolderIds` (asserted by audit check `AEC4 chat folder identity scope` at `util/client-thinning-audit.ts:1071-1105`) — drop folder language from A3F5. |
| **A3F6** Preset import skips image validation | ✅ Real | accurate | `createPresetRecord` (`server/fastify/src/commands/presets.ts:165-178`) calls `validatePresetAssetRefs`; `repairPresetRecord` (`:189-197`) does not. Import route `server/fastify/src/routes/commands.ts:1260` uses `repairPresetRecord`. |
| **A3F7** Arbitrary URL fetch with `risu-auth` | ✅ Real | accurate | `src/ts/server/assets.ts:24` does `const assetUrl = serverAssetUrl(loc) ?? loc`, then `:28-32` attaches `risu-auth`. Any string that is not 64-hex and not `assets/<sha>.<ext>` becomes an authenticated fetch to that string. Reachable via `readImage`/`loadAsset` (`src/ts/globalApi.svelte.ts:187, 266`). |
| **A3F8** Server backups do not preserve assets | ✅ Real | accurate | `server/fastify/src/repository.ts:215-235` writes only `db.json` + `manifest.json`; `:255-273` restores only `db.json`. Manifest records `assetCount` but no bytes. |
| **A3F9** Bundle walker ignores `assets/<sha>.<ext>` | ✅ Real | accurate | `addReference` (`server/fastify/src/risuSave/assetReferences.ts:146-150`) requires `isValidAssetId` (raw 64-hex). Client `serverAssetIdFromReference` (`src/ts/server/assets.ts:1-8`) accepts both raw id and legacy path. Mismatch is real. |
| **A3F10** Asset upload defaults to `.png` | ✅ Real | accurate | `src/ts/globalApi.svelte.ts:213` defaults `fileExtension = 'png'`; `src/ts/process/transformers.ts:203` calls `saveAsset(file)` with no filename for ONNX bytes. Server stores `image/png` for non-image data. |
| **A3F11** Masked array secrets restore by index | ✅ Real | accurate | Wildcard paths at `server/fastify/src/providerSecrets.ts:9, 11, 16, 34` cover `botPresets`, `customModels`, `authRefreshes`, `OaiCompAPIKeys`. `resolvePath:115-126` iterates by array index and reads `source[i]`. Reorder/delete moves the masked placeholder to a different row; restoration copies the wrong secret. |
| **A3F12** Compatibility adapter fan-out conflicts | ✅ Real | accurate | `dispatchCompatibleChatUpdate` (`src/ts/chatCommands.ts:138-164`) fans out three `runChatCommand` calls; each fetches `baseRevision` independently. Server `server/fastify/src/commands/mutations.ts:50-53` rejects stale revisions. Cmd 1 success bumps revision; Cmd 2/3 409 and roll back. |
| **A3F13** Event sink unbounded | ✅ Real | accurate | `InMemoryCommandEventSink.emit` at `server/fastify/src/commands/events.ts:331-341` appends without trim; `list():343-345` returns the full copy. No retention bound. |

Severity: all "High" calls are justified (A3F1, A3F2, A3F3, A3F4, A3F5, A3F7).
A3F8, A3F9, A3F11, A3F12 at "Medium" are accurate. A3F10 and A3F13 at "Low" are
accurate.

## 3. Audit script coverage (A3EC6)

`util/client-thinning-audit.ts` registers 9 checks at `:1267-1277`:

| Check ID | Function | What it asserts |
|---|---|---|
| EC5 active-writer guard | `checkActiveWriterGuard:498-608` | Every *mutating* route is classified; client helpers attach the writer header |
| EC4 stable command ids | `checkStableIdCommandPaths:610-681` + `checkCommandRouteLocalIdMinting:290-336` | `create*Record` validators don't contain `randomUUID(`; inline/route-local id minting is forbidden inside command route handlers |
| EC2 plugin storage gates | `checkPluginStorageGates:683-…` | Plugin storage paths gated in Fastify mode |
| EC6 asset walker validator drift | `checkAssetWalkerValidators:950-1001` | Asset walker validators agree on field set |
| AEC2 import/export current shape | `checkRisuSaveImportExportShape:1002-1070` | RisuSave shape parity |
| AEC4 chat folder identity scope | `checkChatFolderIdentityScope:1071-1105` | `normalizeGlobalChatFolderIds` is invoked from `normalizeAllCharacterChats`; chat folder create surfaces use `chatFolderIdExists` (≥2 occurrences) |
| AEC5 module reference semantics | `checkModuleReferenceSemantics:1107-1154` | Module link validation excludes MCP, rejects unknown ids, present at ≥4 routes |
| AEC6 asset persistence semantics | `checkAssetPersistenceSemantics:1156-1209` | (asset persistence shape) |
| EC1 provider ownership | `checkProviderOwnership:1210-1252` | Fastify server-mode guards on `serverCompletion`, Vertex token writes; `useServerGeneration` not in client settings group map |

Coverage of A3 bug classes:

| Bug | Audit covers? | Why |
|---|---|---|
| **A3F1** (read endpoint registers writer) | No | `checkActiveWriterGuard` only enumerates *mutating* routes; a GET that mutates registration state is invisible to it. |
| **A3F2** (blind 409 replay) | No | No check matches `result.status === 'conflict'` + retry pattern. |
| **A3F3, A3F4** (imported repair helpers mint ids) | No | `checkCommandRouteLocalIdMinting` follows inline `randomUUID()` and *file-local* helpers but stops at imported identifiers — `repairPresetRecord`, `repairGlobalLorebookRecord` are out of reach. |
| **A3F5** chats/messages | No | AEC4 enforces global folder uniqueness via `normalizeGlobalChatFolderIds`; there is no `normalizeGlobalChatIds` or `normalizeGlobalMessageIds`. |
| **A3F5** folders | Yes (already covered) | AEC4 is the structural rule. Drop folder language from A3F5. |
| **A3F6** (import bypasses validators) | No | No check compares validator coverage between create/patch and import surfaces. |
| **A3F7** (auth header on arbitrary URL) | No | No structural check on `readServerAssetBytes` fallthrough. |
| **A3F8** (backup misses assets) | No | `checkAssetPersistenceSemantics` exists but does not assert backup byte preservation. |
| **A3F9** (walker vs client asset-id parsing) | No | `checkAssetWalkerValidators` checks validator drift, not asset-id reach parity between `risuSave/assetReferences.ts` and `src/ts/server/assets.ts`. |
| **A3F10** (filename default) | No | No upload-metadata audit. |
| **A3F11** (index-based secret restore) | No | `checkProviderOwnership` checks Fastify-mode gates only. |
| **A3F12** (multi-command fan-out) | No | No fan-out detection. |
| **A3F13** (unbounded sink) | No | No retention check. |

`pnpm client-thinning:audit` prints `Client-thinning audit passed.` while 12 of
13 bug classes are unaddressed.

## 4. Independent sweep result — three false positives caught

The Explore sub-agent's report (the only sub-agent that did not 529) claimed
three "definite new gaps" not in Alpha 3:

- **NEW-1 Persona cross-duplicate** — **false**. `database.personas` is a flat
  top-level array (`server/fastify/src/commands/personas.ts:23-50`). Its
  dedup-within-array IS global dedup. No parent-character nesting, so the
  A3F5 class does not apply.
- **NEW-2 Loadout cross-duplicate** — **false**. Same shape; `database.loadouts`
  is flat (`server/fastify/src/commands/loadouts.ts:25-50`).
- **NEW-3 Translator-preset cross-duplicate** — **false**. Same shape;
  `database.translatorPresets` is flat
  (`server/fastify/src/commands/translatorPresets.ts:32-49`).

The A3F5 bug class requires the asymmetry "stored under a parent, addressed
globally". Flat collections do not have it. The Explore agent's category
sweeps for passive-read paths, conflict retries, id-minting points, fan-out,
direct writers, mutating routes without guards, header leaks, secret leaks,
and bundle/import paths produced **no genuine additions** beyond A3F1-A3F13.

Within the Alpha 3 documented scope (Fastify-served web mode; active writer
/ command-id / asset / secret / event surfaces), **Alpha 3 is comprehensive**.

## 5. Why Phase 9 keeps reopening

Five of the seven Alpha 3 bug classes are direct analogues of Alpha 1 / 2
findings on adjacent code:

| Alpha 3 bug | Earlier same-class fix |
|---|---|
| A3F3, A3F4 (imported `repair*Record` mints id in public route) | Alpha 2 closed *inline* `randomUUID()` in command routes; the imported variant was not added to the audit |
| A3F5 chats/messages (per-parent dedup + global resolver) | Alpha 1 added `normalizeGlobalChatFolderIds` for folders; the equivalent for chats and messages was never written |
| A3F6 (preset import skips validator) | Alpha 2 tightened preset create/patch; the import-path validator divergence was not asserted |
| A3F9 (walker accepts fewer formats than client) | Alpha 1 normalized asset-id parsing; the walker was not re-checked |
| A3F11 (index-based restore on wildcard arrays) | Alpha 2 closed single-element masked secret paths; the multi-row case was untested |

The loop has one structural cause: **the audit script does not learn from
each fix**. Every closeout pass lands behavior fixes and focused tests;
almost none extend `util/client-thinning-audit.ts` with a rule that would
catch the bug class one file over. So the next reviewer (with better
read-budget than the last) finds the same pattern in the next file and a
fresh Alpha bucket opens.

The Alpha 3 doc itself names this in EC6: *"every Alpha 3 bug class should
become either a structural audit check or a documented, tested exclusion"*.
Honoring EC6 is the only definitive exit from the loop.

## 6. Recommended closeout plan

**Audit rules first, behavior fixes second.** Each behavior fix must be gated
on a failing-then-passing audit rule, so the same bug class cannot reappear
elsewhere.

### Audit rules to add to `util/client-thinning-audit.ts`

- **R1 (covers A3F1)**: Forbid passive projection refresh from calling
  helpers that attach `activeWriterSessionHeader()`. Implementation: walk the
  call graph from `startServerProjectionEvents` / `scheduleServerProjectionRefresh`
  / `refreshServerProjection` in `src/ts/bootstrap.ts` and assert none of the
  reachable helpers attaches the writer header. The simplest fix path is to
  split bootstrap into write-register and read-refresh modes (or pass an
  explicit `{ register: false }` to the helper). The audit then asserts the
  flag.
- **R2 (covers A3F2)**: Forbid `result.status === 'conflict'` retry blocks
  outside `src/ts/server/commands.ts:runServerCommand`. Concretely, scan
  every `*.ts`/`*.svelte` file for the pattern `if (...status === 'conflict')`
  followed by another call to the same command, allowlist `runServerCommand`,
  fail elsewhere.
- **R3 (covers A3F3, A3F4)**: Extend `checkCommandRouteLocalIdMinting` to
  follow **imported** identifiers. For every Fastify command route handler,
  forbid calling any function whose name starts with `repair` and whose body
  (resolved across modules via ts-morph) contains `randomUUID`. Allowlist
  explicit server-generated commands with a comment and a route-name regex.
- **R4 (covers A3F5 chats/messages)**: For every per-parent dedup helper
  (`ensureCharacterChats`, `ensureChatMessages`), require a companion
  `normalizeGlobal*Ids` invoked from `normalizeAllCharacterChats`, mirroring
  the AEC4 pattern that already covers folders.
- **R5 (covers A3F9)**: Compare the regex set in
  `src/ts/server/assets.ts:serverAssetIdFromReference` against
  `server/fastify/src/risuSave/assetReferences.ts:isValidAssetId`. They must
  accept the same shapes; the audit asserts string-equal coverage or a
  documented downgrade.
- **R6 (covers A3F11)**: For every wildcard secret path in
  `server/fastify/src/providerSecrets.ts:SECRET_PATHS`, require either a
  stable row-id field on the array element type *and* an id-keyed restoration
  helper, **or** an explicit allowlist comment with rationale and a tested
  no-op for reordered payloads.
- **R7 (covers A3F7)**: `readServerAssetBytes` must reject (not fetch)
  strings that fail both `SERVER_ASSET_ID_RE` and `LOCAL_ASSET_PATH_RE`. Audit
  asserts no fallthrough fetch is reachable from `readImage` / `loadAsset`.

A3F6, A3F8, A3F10, A3F12, A3F13 do not need new audit rules of their own —
they are local enough that a focused regression test plus the existing
audit suffices, **provided** the docs record an explicit closeout policy
(see §7).

### Behavior fixes (after rules land)

The Alpha 3 `closeout-buckets.md` ordering is reasonable. Run each behavior
fix only after the corresponding new audit rule fails on HEAD and passes
after the fix.

## 7. Documents to update (instructions for the next agent)

The next agent merging this audit must update or replace the following
files to keep the doc tree consistent. Treat this list as the single
source of truth for that pass.

### Keep as-is (do not edit)

- `docs/audit-claude.md` — earlier closure-claim audit; historical record.
- `docs/audit-codex.md`, `docs/audit-codex-latest.md` — Codex audits, may be
  stale per `docs/handover.md:14-17` but not the responsibility of this
  pass.
- `docs/fastify/client-thinning-alpha/` — closed Alpha 1 record.
- `docs/fastify/client-thinning-alpha-2/` — closed Alpha 2 record.
- `docs/fastify/phases-completed/` — historical phase records.

### Update

- **`docs/fastify/client-thinning-alpha-3/open-findings.md`**
  - In the summary table and the A3F5 section, change wording from
    "Global chat/message/folder addressing" to "Global chat/message
    addressing". Note explicitly that folder global uniqueness is already
    enforced by `normalizeGlobalChatFolderIds` and audit rule AEC4. Add a
    one-line cross-reference to `util/client-thinning-audit.ts:1071-1105`.
  - Mark each finding's "Required closeout" with the corresponding new
    audit rule (R1-R7) so the implementor knows which check to write.
- **`docs/fastify/client-thinning-alpha-3/closeout-buckets.md`**
  - Insert a Bucket 0 at the top: "Audit rules R1-R7". State that no
    behavior bucket may close until its corresponding audit rule fails
    on the pre-fix tree and passes on the post-fix tree.
  - Move A3F5 folder language to a note explaining it is already closed.
- **`docs/fastify/client-thinning-alpha-3/decisions.md`**
  - Under A3EC6 ("Audit Shape"), record the rule-first ordering as the
    binding decision. Reference the R1-R7 list in this document.
- **`docs/fastify/client-thinning-alpha-3/README.md`**
  - Add a one-line pointer to `docs/audit-claude-latest.md` under the
    "Document Map" section.
- **`docs/handover.md`**
  - Replace the body with a pointer to this document and a short note
    that the Alpha 3 read-only handover is superseded by
    `docs/audit-claude-latest.md`.

### Do not update yet (loop-prevention gate)

- `docs/fastify/status.md`, `docs/fastify/status/next-steps.md`,
  `docs/fastify/client-thinning/README.md` — leave at their current
  "Alpha 2 closed" wording. They are updated only after R1-R7 are in
  the audit script, the audit fails on HEAD and passes after fixes, and
  the full verification ladder runs green:

  ```bash
  pnpm client-thinning:audit
  pnpm check
  pnpm test
  pnpm api:test
  pnpm build
  pnpm smoke:fastify-browser
  ```

### Memory updates

Update the memory index entry for Phase 9 (existing
`phase9-redefined-as-client-thinning-workstream.md`) to note that Alpha 3
is open with the rule-first closeout policy decided on 2026-05-28, and link
this document.

## 8. Loop-exit checklist

A future agent should treat Alpha 3 as closed only when every box is ticked:

- [ ] R1-R7 implemented in `util/client-thinning-audit.ts`, each with a
      committed test that exercises the failing pattern (so dead rules
      cannot accumulate).
- [ ] Each R rule fails on pre-fix HEAD and passes on post-fix HEAD; the
      diff is recorded in the Alpha 3 history.
- [ ] A3F5 wording narrowed to chats and messages; folder note added.
- [ ] A3F8 contract decision recorded in `decisions.md` (either backups
      preserve asset bytes, or backups are documented metadata-only and
      every UI surface promising round-trip is corrected).
- [ ] A3F10, A3F12, A3F13 closed with focused regression tests; no audit
      rule required, but each test must reference the finding id.
- [ ] Full verification ladder green on a clean checkout.
- [ ] Status docs (§7 "Do not update yet") then reconciled in a single
      commit that also closes this audit.

If any of the above is skipped, expect Alpha 4.

## 9. Sources

- `docs/fastify/client-thinning-alpha-3/open-findings.md`
- `docs/fastify/client-thinning-alpha-3/decisions.md`
- `docs/fastify/client-thinning-alpha-3/closeout-buckets.md`
- `docs/fastify/client-thinning-alpha-3/README.md`
- `docs/fastify/client-thinning-alpha-2/final-audit.md`
- `docs/fastify/status.md`
- `docs/handover.md`
- `util/client-thinning-audit.ts` (all checks read)
- Source files cited in §2 (all read at the line ranges given)
