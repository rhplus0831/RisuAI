# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/), and the current
status snapshot lives in [`../status.md`](../status.md).

Policy note: no actual Fastify users exist yet; update current schemas
and import paths directly instead of preserving intermediate Fastify
shapes.

## Last Done

**9-8a - Multipart `.risu` import route** is the latest landed slice.

- `@fastify/multipart` is registered in `server/fastify/src/app.ts` with the
  configured body limit and a one-file limit.
- `POST /api/v1/import/risusave` now keeps the existing JSON `{ database }`
  fixture path and additionally accepts multipart uploads for real `.risu`
  files.
- Multipart uploads decode through `decodeRisuSaveImportSnapshot()` in
  `server/fastify/src/risuSave/importSnapshot.ts`, apply the normalized
  database through repository import helpers, and run the same legacy Hypa V3
  memory replacement path as JSON imports.
- The multipart response returns `revision`, decoded `envelope`,
  `importReport.unsupportedReferences`, and the zeroed asset report reserved
  for 9-8c asset walking. Unsupported remote/cache-only block references are
  reported explicitly; no browser cache, localForage, Tauri remote, OPFS, or
  AutoStorage recovery was added.
- Focused route coverage in
  `server/fastify/__tests__/risuSaveImportRoute.test.ts` proves JSON fallback,
  auth, legacy uploads, RISUSAVE block uploads, unsupported-reference reports,
  missing-file rejection, malformed-upload rejection, and no persistence
  mutation on malformed input.

## Immediate Pickup

Immediate pickup: **9-8b - Repository `.risu` export route**.

- Add `/api/v1/export/risusave` using the repository-backed export adapter in
  `server/fastify/src/risuSave/exportSnapshot.ts`.
- Return downloadable `.risu` bytes with a concrete filename and content type.
  Support the route-ready legacy and RISUSAVE block encoders already added in
  9-7e; keep the request shape small and explicit.
- Preserve server asset ids as JSON references only. Do not walk asset
  references, read asset bytes, include ZIP bundles, or touch browser caches,
  Tauri remotes, OPFS, AutoStorage, localForage, or Svelte database state.
- Return validation errors from malformed/missing persisted databases as
  `400` responses. Auth behavior should match the import route.
- Keep asset reference walking in 9-8c and bundle export in 9-8d.
- Treat exported snapshots as current Phase 9 schema targets. Do not add
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

1. 9-8b - Repository `.risu` export route.
2. 9-8c - Asset reference walker.
3. 9-8d - Bundle export route.
4. 9-9a - Server-backed browser smoke harness.
5. 9-9b - Generation and memory fixture closeout.
6. 9-9c - Server-backed storage-write audit.
7. 9-9d - Manual Fastify web and Tauri local verification.
8. 9-9e - Phase 9 docs closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for
  server-side string flattening.

## Verification

For the current 9-8b slice, start with focused server export route and
`.risu` codec coverage plus type checks:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts
pnpm api:test -- server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
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
  [`../phases-completed/phase-9-client-thinning-9-8a.md`](../phases-completed/phase-9-client-thinning-9-8a.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
