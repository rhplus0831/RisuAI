# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/), and the current
status snapshot lives in [`../status.md`](../status.md).

Policy note: no actual Fastify users exist yet; update current schemas
and import paths directly instead of preserving intermediate Fastify
shapes.

## Last Done

**9-9a - Server-backed browser smoke harness** is the latest landed slice.

- Added `pnpm smoke:fastify-browser`, backed by
  `playwright.fastify-smoke.config.ts` and
  `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts`.
- The smoke command builds the SPA with `VITE_FASTIFY_BROWSER_SMOKE=TRUE` and
  `VITE_RISU_LEGAL_CONFIGURED=TRUE`, then starts Fastify against a temporary
  no-password data dir and serves the built `dist/` bundle.
- The browser smoke verifies Fastify static flag injection, startup
  `/api/v1/bootstrap`, `/api/v1/events` subscription, a representative
  `PATCH /api/v1/commands/settings/runtime` mutation, and the debounced
  projection refresh after the command event.
- Added a smoke-only browser hook in `src/ts/server/browserSmoke.ts` plus a
  smoke-only no-password auth shortcut in `getNodeServerProxyAuth()`. These are
  gated by the smoke build flag and are not active in normal builds.

## Immediate Pickup

Immediate pickup: **9-9b - Generation and memory fixture closeout**.

- Re-run and reconcile server-backed sendChat, generation persistence,
  rollback, and Hypa V3 memory fixture coverage.
- Start from the fixture families already used by 9-3d, 9-5e-iii, and Phase 8
  closeout rather than adding new command surfaces.
- Keep this slice to generation/memory fixture confidence. The full
  server-backed storage-write audit remains 9-9c.
- Preserve the 9-9a browser smoke as the top-level web startup sanity check;
  do not fold fixture-specific assertions into that smoke unless browser-level
  startup itself regresses.

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

1. 9-9b - Generation and memory fixture closeout.
2. 9-9c - Server-backed storage-write audit.
3. 9-9d - Manual Fastify web and Tauri local verification.
4. 9-9e - Phase 9 docs closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for
  server-side string flattening.

## Verification

For the current 9-9b slice, start with the server-backed generation and memory
fixtures. Keep the 9-9a browser smoke as the web startup harness, and keep the
9-8 bundle/export/import baselines available when touching `.risu` or asset
bundle code:

```bash
pnpm smoke:fastify-browser
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
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

Latest recorded focused baseline, after 9-9a:

- `pnpm smoke:fastify-browser`
  - passed; built the SPA and ran the Playwright browser smoke through Fastify
    startup, bootstrap, events, one runtime settings command, and projection
    refresh. Build emitted existing CSS `::highlight`, browser
    externalization, plugin-timing, and chunk-size warnings.
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts src/ts/server/events.test.ts src/ts/server/commands.test.ts`
  - command selected the full client suite: 65 files, 734 tests passed, 4
    skipped.
- `pnpm api:test -- server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/commands.test.ts`
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
  [`../phases-completed/phase-9-client-thinning-9-9a.md`](../phases-completed/phase-9-client-thinning-9-9a.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
