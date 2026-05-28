# Codex Latest Audit: Phase 9 Client Thinning

Date: 2026-05-28

## Verdict

The original Phase 9 migration milestone and the committed Alpha 1/Alpha 2
follow-ups are closed in git history, but the current workspace is not
definitively complete for the standing Fastify client-thinning/server-projection
workstream.

The closeout loop is real: the full verification ladder is green, including
`pnpm client-thinning:audit`, while newer Alpha 3 findings still match live code
paths. Do not mark the client-thinning workstream closed again until the Alpha 3
findings are fixed or explicitly accepted, covered by focused regression tests,
and added to the repeatable audit where practical.

## Current Repository State

- Current branch: `fastify`, ahead of `origin/fastify` by 52 commits.
- Current HEAD during this audit: `c42b215f docs: close client thinning alpha 2`.
- Worktree status during this audit:
  - `?? docs/fastify/client-thinning-alpha-3/`
  - `?? docs/handover.md`
- The untracked Alpha 3 docs are important. They contradict the committed
  high-level status docs and line up with live code evidence.

## Sources To Reconcile

Use these as the merge inputs:

- `docs/fastify/status.md` currently says all phases are complete and no open
  findings remain.
- `docs/fastify/status/next-steps.md` currently says all Phases 0-9 are closed
  and points to Alpha 2 as the latest follow-up.
- `docs/fastify/client-thinning/README.md` says EC1 through EC7 are closed and
  defines the standing server-projection contract.
- `docs/fastify/client-thinning/open-findings.md` says there are no unresolved
  F-numbered server-projection findings.
- `docs/fastify/client-thinning-alpha-2/*` records the committed Alpha 2
  closeout.
- `docs/fastify/client-thinning-alpha-3/*` is the current open handoff and
  should become the latest live source if it is committed.
- `docs/handover.md` records the audit handoff and the closeout rule.
- `docs/audit-codex.md` and `docs/audit-claude.md` are stale top-level audits.
  They are useful history only; they predate later Alpha 1/Alpha 2 closeout
  commits and should not override the newer Alpha 3 audit.

## Sub-Agent Coverage

Three sub-agents were summoned for independent read-only checks:

- Documentation/history agent: confirmed the committed docs say closed while
  untracked Alpha 3 docs reopen 13 findings.
- Implementation agent: confirmed the Alpha 3 findings still match live code
  paths.
- Verification agent: ran/checked the verification surface and confirmed the
  current audit passes while missing the Alpha 3 classes.

All three converged on the same conclusion: green verification is a baseline,
not closeout proof.

## Verification Run

The following commands were run from `/home/codex/risuai-fastify` and passed:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Observed results:

- `pnpm client-thinning:audit`: passed.
- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 78 files passed, 788 tests passed, 4 skipped.
- `pnpm api:test`: 69 files passed, 1249 tests passed.
- `pnpm build`: passed with existing nonblocking CSS, browser-externalized module,
  dynamic-import, plugin-timing, and large-chunk warnings.
- `pnpm smoke:fastify-browser`: buildsite passed, Playwright smoke passed 1 test.

Important: these passing commands do not prove Alpha 3 closed. They prove the
current closeout ladder is too narrow for the newly identified bug classes.

## CI Gap

No GitHub workflow currently runs the full Phase 9/client-thinning closeout
ladder:

- `.github/workflows/codeql.yml` runs CodeQL analysis only.
- `.github/workflows/docker-build.yml` builds/pushes Docker images.
- `Dockerfile` runs only `pnpm build` during the image build.

If this audit is converted into a formal closeout requirement, add CI coverage
for at least `pnpm client-thinning:audit`, `pnpm check`, `pnpm test`, and
`pnpm api:test`. Browser smoke may remain a heavier/manual gate if CI cost is a
concern, but docs should say so explicitly.

## Confirmed Open Findings

### A3F1 - Passive Bootstrap Refresh Steals Active-Writer Ownership

Severity: High

SSE/event projection refresh calls bootstrap, the client bootstrap helper always
sends `risu-writer-session`, and the server registers any bootstrap request with
that header as the active writer.

Evidence:

- `src/ts/bootstrap.ts:178`
- `src/ts/server/bootstrap.ts:33`
- `server/fastify/src/routes/bootstrap.ts:22`
- `server/fastify/src/activeWriter.ts:13`

Required merge note: document this as an open active-writer contract bug. The
fix should split writer-registering bootstrap from passive projection refresh, or
add an explicit read-only bootstrap mode.

### A3F2 - Generic Settings Blindly Replay 409 Conflicts

Severity: High

`patchServerBackedSetting` retries the same patch after a conflict using
`result.currentRevision`. The central command wrapper no longer does this, so
the settings helper is a separate stale-write path.

Evidence:

- `src/ts/setting/utils.ts:132`
- `src/ts/setting/utils.ts:138`
- `src/lib/Setting/Wrappers/SettingCheck.svelte:27`

Required merge note: closeout needs a no-retry settings test and an audit check
for conflict retry drift.

### A3F3 - Preset Copy/Import Still Mint Command-Path IDs

Severity: High

The client creates an optimistic id when copying a preset but does not send it to
the server. The server copy route clears the id and calls `repairPresetRecord`,
which can mint a different durable id. Preset import also uses the repair helper.

Evidence:

- `src/ts/storage/database.svelte.ts:2215`
- `src/ts/server/commands.ts:1106`
- `server/fastify/src/routes/commands.ts:1189`
- `server/fastify/src/routes/commands.ts:1260`
- `server/fastify/src/commands/presets.ts:189`

Required merge note: command paths should require client-supplied ids unless a
server-generated-id exception is explicit, tested, and audit-visible.

### A3F4 - Empty-Lorebook Delete Fallback Mints A Command-Path ID

Severity: High

Deleting the last global lorebook through the public route pushes a repaired
default lorebook, which can mint an id server-side.

Evidence:

- `server/fastify/src/routes/commands.ts:3226`
- `server/fastify/src/routes/commands.ts:3227`
- `server/fastify/src/commands/lorebooks.ts:147`

Required merge note: prefer rejecting last-lorebook delete or requiring the
client to provide the replacement id.

### A3F5 - Global Chat/Message Addressing Can Hit The Wrong Duplicate ID

Severity: High

Patch/delete/fork routes resolve chat/message ids globally, but create and
normalization paths only dedupe chats within a character and messages within a
chat. Duplicate ids across parents can make later routes mutate the first
matching row.

Evidence:

- `server/fastify/src/commands/chats.ts:59`
- `server/fastify/src/commands/chats.ts:291`
- `server/fastify/src/routes/commands.ts:2394`
- `server/fastify/src/commands/messages.ts:61`
- `server/fastify/src/commands/messages.ts:141`
- `server/fastify/src/routes/commands.ts:2908`

Required merge note: chat-folder global uniqueness appears separately handled by
`normalizeGlobalChatFolderIds` and route checks, but chat and message ids remain
unproven. Close by enforcing global uniqueness or changing routes to be
parent-scoped.

### A3F6 - Preset Import Bypasses Preset Image Asset Validation

Severity: Medium

Preset create and patch validate image asset references. Preset import uses
`repairPresetRecord`, which validates name/id shape but not image refs.

Evidence:

- `server/fastify/src/commands/presets.ts:175`
- `server/fastify/src/commands/presets.ts:189`
- `server/fastify/src/commands/presets.ts:273`
- `server/fastify/src/routes/commands.ts:1260`

Required merge note: combine this with A3F3 if preset import is rewritten around
`createPresetRecord`.

### A3F7 - Asset Reads Can Fetch Arbitrary URLs With `risu-auth`

Severity: High

Fastify image/asset reads call `readServerAssetBytes`. If the reference is not a
raw server asset id or accepted legacy asset path, the helper fetches the string
unchanged while attaching `risu-auth`.

Evidence:

- `src/ts/globalApi.svelte.ts:187`
- `src/ts/globalApi.svelte.ts:266`
- `src/ts/server/assets.ts:20`
- `src/ts/server/assets.ts:24`
- `src/ts/server/assets.ts:28`

Required merge note: Fastify mode should reject unknown asset references or fetch
external URLs only without `risu-auth` under an explicit contract.

### A3F8 - Server Backups Do Not Preserve Asset Bytes

Severity: Medium

Fastify backups write `db.json` and `manifest.json`; restore copies only
`db.json`. Asset metadata can survive while asset bytes are missing.

Evidence:

- `server/fastify/src/repository.ts:121`
- `server/fastify/src/repository.ts:215`
- `server/fastify/src/repository.ts:225`
- `server/fastify/src/repository.ts:263`
- `server/fastify/src/repository.ts:269`

Required merge note: either make backups include/restore asset files or document
them as metadata-only and adjust user-facing language/tests.

### A3F9 - Bundle Asset Walker Ignores Supported Legacy Asset-Path Refs

Severity: Medium

The client accepts `assets/<sha>.<ext>` references, but the server RisuSave asset
walker only records raw 64-character asset ids. Existing tests lock in ignoring
legacy paths.

Evidence:

- `src/ts/server/assets.ts:1`
- `src/ts/server/assets.ts:4`
- `server/fastify/src/risuSave/assetReferences.ts:146`
- `server/fastify/__tests__/risuSaveAssetReferences.test.ts:121`
- `server/fastify/__tests__/risuSaveAssetReferences.test.ts:125`

Required merge note: decide whether current-shape Fastify data may contain
legacy asset paths. If yes, bundle walking must include them. If no, imports and
commands should reject or normalize them.

### A3F10 - Fastify Asset Uploads Can Lose MIME/Extension Metadata

Severity: Low

`saveAsset` defaults missing filenames to `png`. Non-image callers such as ONNX
asset handling can call `saveAsset(file)` without filename metadata.

Evidence:

- `src/ts/globalApi.svelte.ts:213`
- `src/ts/process/transformers.ts:203`
- `server/fastify/src/repository.ts:146`
- `server/fastify/src/risuSave/bundleExport.ts:67`

Required merge note: lower severity unless those non-image assets must
round-trip through Fastify bundle export.

### A3F11 - Masked Array Secrets Restore By Index

Severity: Medium

Provider secret masking supports wildcard array paths. Placeholder resolution
restores array secrets by index, so reorder/delete patches can transplant secrets
to another row.

Evidence:

- `server/fastify/src/providerSecrets.ts:7`
- `server/fastify/src/providerSecrets.ts:9`
- `server/fastify/src/providerSecrets.ts:11`
- `server/fastify/src/providerSecrets.ts:16`
- `server/fastify/src/providerSecrets.ts:115`
- `server/fastify/src/providerSecrets.ts:123`
- `server/fastify/src/routes/commands.ts:4228`

Required merge note: closeout needs row-identity based restoration or rejection
for masked placeholders when identity cannot be proven.

### A3F12 - Compatibility Adapters Can Fan Out Conflicting Concurrent Commands

Severity: Medium

`dispatchCompatibleChatUpdate` can issue chat metadata, message replacement, and
scriptstate commands back-to-back for one optimistic local mutation. Each command
reads base revision independently; one success can make siblings conflict and
roll back the shared optimistic snapshot.

Evidence:

- `src/ts/chatCommands.ts:146`
- `src/ts/chatCommands.ts:151`
- `src/ts/chatCommands.ts:155`
- `src/ts/server/commands.ts:2155`
- `server/fastify/src/commands/mutations.ts:50`

Required merge note: close by serializing same-snapshot command dispatches or by
adding composite server commands where atomicity matters.

### A3F13 - Command Event Sink Keeps Unbounded Event History

Severity: Low

The in-memory command event sink appends every event and returns full process
lifetime history from `list()`.

Evidence:

- `server/fastify/src/commands/events.ts:327`
- `server/fastify/src/commands/events.ts:331`
- `server/fastify/src/commands/events.ts:343`

Required merge note: decide and document retention policy. Bound the buffer if
history is only for tests/debugging.

## Adjacent Stubs And Deferrals

These are not automatically Alpha 3 blockers, but the merge agent should avoid
misclassifying them:

- Plugin V3 `saveSecretHeader` is explicitly not implemented:
  `src/ts/plugins/apiV3/v3.svelte.ts:1415`.
- MCP character asset reference edits are intentionally unsupported in
  server-backed mode: `src/ts/process/mcp/risuaccess/characters.ts:966`.
- `.risum` module import is intentionally unsupported in server-backed web mode:
  `src/ts/process/modules.ts:288`.
- Legal helper TODOs exist in `src/ts/globalApi.svelte.ts:2018` and
  `src/ts/globalApi.svelte.ts:2026`; these are not Phase 9 client-thinning
  findings.

## Merge Instructions

1. Keep the archived Phase 9 migration milestone closed. Do not rewrite the
   older slice history as if 9-0 through 9-9e failed.
2. Treat client thinning as a standing workstream. The right status is:
   "original Phase 9, Alpha 1, and Alpha 2 closed; Alpha 3 is open."
3. Promote or commit `docs/fastify/client-thinning-alpha-3/` as the current live
   source if the team accepts this audit.
4. Update `docs/fastify/status.md` and `docs/fastify/status/next-steps.md` so
   they point to Alpha 3 as the latest open follow-up, not Alpha 2 as the latest
   final closeout.
5. Leave `docs/audit-codex.md` and `docs/audit-claude.md` as stale historical
   audits, or add a short header pointing readers to this file.
6. Extend `util/client-thinning-audit.ts` as each Alpha 3 bucket closes. A fix
   without audit coverage is exactly how the open-close loop repeats.
7. Do not mark Alpha 3 closed until:
   - all A3F findings are fixed or explicitly accepted,
   - focused tests cover each decision,
   - `pnpm client-thinning:audit` covers the old failure patterns where
     practical,
   - the full ladder passes again.

## Suggested Bucket Order

1. Active-writer and conflict semantics: A3F1, A3F2, A3F12.
2. Stable-id command holes: A3F3, A3F4, plus preset import overlap with A3F6.
3. Global id addressing: A3F5.
4. Asset ownership and backup durability: A3F6, A3F7, A3F8, A3F9, A3F10.
5. Secret placeholder row identity: A3F11.
6. Event retention and final docs/audit closeout: A3F13 and status docs.

## Closeout Ladder

Run this before any future closeout claim:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Focused tests worth adding or rerunning around Alpha 3:

```bash
pnpm api:test server/fastify/__tests__/commands.test.ts server/fastify/__tests__/activeWriter.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/assets.test.ts server/fastify/__tests__/backups.test.ts -- --run
pnpm test src/ts/server/commands.test.ts src/ts/server/assets.test.ts src/ts/server/bootstrap.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts src/ts/process/request/tests/serverChat.test.ts src/ts/plugins/plugins.test.ts -- --run
```
