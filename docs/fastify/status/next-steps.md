# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/), and the current
status snapshot lives in [`../status.md`](../status.md).

Policy note: no actual Fastify users exist yet; update current schemas
and import paths directly instead of preserving intermediate Fastify
shapes.

## Last Done

**9-8d - Bundle export route** is the latest landed slice.

- Added `server/fastify/src/risuSave/bundleExport.ts` and auth-gated
  `GET /api/v1/export/bundle`.
- The bundle route reuses the 9-8b repository `.risu` export query semantics
  and the 9-8c asset walker.
- ZIP contents are `database.risu`, `manifest.json`, and only referenced
  asset files that exist in repository metadata and on disk.
- The manifest reports compact asset counts, included assets, missing
  references, metadata-present files missing from disk, and orphaned stored
  assets. Orphaned assets are reported but not bundled.
- No browser cache, localForage, Tauri remote, OPFS, AutoStorage, or Svelte
  database state path was added.

## Immediate Pickup

Immediate pickup: **9-9a - Server-backed browser smoke harness**.

- Add or document a repeatable browser-level smoke path for Fastify-served web
  startup.
- Cover bootstrap projection load, command-event subscription/re-bootstrap,
  and one representative command mutation through the server-backed web path.
- Keep the harness focused on server-backed web behavior. Tauri local storage
  remains local and should not be pulled into this smoke path.
- Do not broaden this slice into the generation/memory fixture closeout or the
  full storage-write audit; those remain 9-9b and 9-9c.

## Implementation Notes

- Command code lives in `server/fastify/src/commands/`,
  `server/fastify/src/routes/commands.ts`, and
  `src/ts/server/commands.ts`. The command map remains the source of
  truth for names, payload behavior, events, and plugin bridge policy.
- Browser projection loads through `src/ts/server/bootstrap.ts` and
  refreshes from `src/ts/server/events.ts`. Debounced re-bootstrap is the
  Phase 9 target; per-event patches remain future work.
- The browser-side trusted write helper lives in
  `src/ts/server/projectionWriteGuard.svelte.ts`; keep it as the narrow
  escape hatch for command-owned optimistic writes, rollbacks, and
  bootstrap projection replacement.
- Tauri keeps its local storage path. Phase 9 gates should be
  server-backed web specific.
- Storage and secret gates are already closed: Fastify startup/save,
  backup/restore, asset reads, RISUSAVE caches/remotes, cold-storage
  helpers, Google Search credential storage, and provider secret
  projection are guarded. Runtime-only browser caches remain local
  because they are not authoritative server database state.
- Use `MASKED_PROVIDER_SECRET`, `maskProviderSecrets()`, and
  `resolveMaskedProviderSecretPlaceholders()` from
  `server/fastify/src/providerSecrets.ts` if later server routes need the
  same projection or placeholder semantics.
- Character scalar patches reject child collections. Chat metadata
  patches reject `message`, `localLore`, `scriptstate`, generation /
  runtime fields, and child collections except the 9-4c `modules` field.
  Use message, generation, scriptstate, lorebook, or module commands for
  those fields.
- MCP module import, MCP asset import, and server-backed `.risum` module
  import remain explicitly unsupported until later slices define
  dedicated server-owned paths.

## Later Queue

1. 9-9a - Server-backed browser smoke harness.
2. 9-9b - Generation and memory fixture closeout.
3. 9-9c - Server-backed storage-write audit.
4. 9-9d - Manual Fastify web and Tauri local verification.
5. 9-9e - Phase 9 docs closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for
  server-side string flattening.

## Verification

For the current 9-9a slice, start with the new or documented browser smoke
harness plus the bootstrap/events/command surfaces it exercises. Keep the 9-8
bundle/export/import baselines available when touching `.risu` or asset bundle
code:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts
pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm check
```

Run the full matrix before closing a parent phase or a broad
server-backed behavior surface:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Latest recorded focused baseline, after 9-8d:

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - 2 files and 23 Fastify `.risu` codec / asset-reference tests passed.
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - command selected the full Fastify API suite: 68 files and 1162 tests
    passed.
- `pnpm check` - clean.

Last recorded broader baselines:

- 9-6c `pnpm test -- src/ts/storage/backup.test.ts src/ts/server/backups.test.ts`
  - passed; command selected the full client suite: 730 tests, 4 skipped.
- 9-6c `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
  - passed; command selected the full Fastify API suite: 1119 tests.
- 9-6c `pnpm check` - clean.
- 9-5d `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-8d.md`](../phases-completed/phase-9-client-thinning-9-8d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
