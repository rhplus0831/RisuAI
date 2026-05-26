# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/), and the current
status snapshot lives in [`../status.md`](../status.md).

Policy note: no actual Fastify users exist yet; update current schemas
and import paths directly instead of preserving intermediate Fastify
shapes.

## Last Done

**9-8b - Repository `.risu` export route** is the latest landed slice.

- `GET /api/v1/export/risusave` is auth-gated and returns downloadable
  `database.risu` bytes with `application/octet-stream`.
- The route uses the repository-backed export adapter in
  `server/fastify/src/risuSave/exportSnapshot.ts`. RISUSAVE block export is
  the default, and the small query surface supports `envelope=legacy-raw`,
  `legacy-compressed`, `legacy-stream`, or `risusave-blocks`; `compression`
  is block-export-only.
- Missing or malformed persisted databases return `400` validation responses.
- Server asset ids are preserved as JSON references only. No asset walking,
  asset-byte reads, ZIP bundles, browser cache, localForage, Tauri remote,
  OPFS, AutoStorage, or Svelte database state was added.
- Focused route coverage in
  `server/fastify/__tests__/risuSaveExportRoute.test.ts` proves default block
  download behavior, compressed block export, legacy export, auth, invalid
  query rejection, missing persisted database rejection, malformed persisted
  database rejection, and asset-id reference preservation.

## Immediate Pickup

Immediate pickup: **9-8c - Asset reference walker**.

- Add a pure server helper that scans the current persisted database for
  Fastify server asset ids and compares them with repository asset metadata.
- Report referenced, missing, and orphaned asset ids without over-including
  stored assets. Keep the helper independent from HTTP, ZIP writing, browser
  caches, Tauri remotes, OPFS, AutoStorage, localForage, and Svelte database
  state.
- Cover character images, emotion/additional assets, VITS files, character
  card assets, user icon, custom background, persona icons, folder images,
  bot preset images, and any other known Phase 9 server asset reference fields.
- Keep bundle export route wiring and asset-byte inclusion in 9-8d.
- Treat the scan target as the current Phase 9 schema. Do not add
  compatibility migrations for intermediate Fastify shapes.

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

1. 9-8c - Asset reference walker.
2. 9-8d - Bundle export route.
3. 9-9a - Server-backed browser smoke harness.
4. 9-9b - Generation and memory fixture closeout.
5. 9-9c - Server-backed storage-write audit.
6. 9-9d - Manual Fastify web and Tauri local verification.
7. 9-9e - Phase 9 docs closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for
  server-side string flattening.

## Verification

For the current 9-8c slice, start with focused asset-walker coverage plus
the export/import route and `.risu` codec coverage:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts
pnpm api:test -- server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
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

Last recorded focused baseline after 9-8b:

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - 20 Fastify `.risu` codec / import-export snapshot tests passed.
- `pnpm api:test -- server/fastify/__tests__/risuSaveExportRoute.test.ts`
  - command selected the full Fastify API suite: 66 files and 1153 tests
    passed.
- `pnpm api:test -- server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - command selected the full Fastify API suite: 66 files and 1153 tests
    passed.
- `pnpm check` - clean.

Last recorded focused baseline after 9-8a:

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - 20 Fastify `.risu` codec / import-export snapshot tests passed.
- `pnpm api:test -- server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - command selected the full Fastify API suite: 65 files and 1147 tests
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
  [`../phases-completed/phase-9-client-thinning-9-8b.md`](../phases-completed/phase-9-client-thinning-9-8b.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
