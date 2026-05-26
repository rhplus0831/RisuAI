# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/), and the current
status snapshot lives in [`../status.md`](../status.md).

Policy note: no actual Fastify users exist yet; update current schemas
and import paths directly instead of preserving intermediate Fastify
shapes.

## Last Done

**9-7d - Decode normalization and validation** landed in `6f71dcc0`.

- `server/fastify/src/risuSave/importSnapshot.ts` now owns the pure
  server-side `.risu` import snapshot API. It consumes the production
  legacy envelope and RISUSAVE block codecs, assembles decoded saves into
  current Phase 9 database resource shapes, and keeps route wiring /
  repository writes out of the slice.
- Legacy and block decoded payloads run through command-owned
  normalizers for characters, chats, messages, presets, prompt items,
  personas, translator presets, modules, loadouts, plugins,
  plugin-storage, lorebooks, and script / trigger child ids.
- RISUSAVE root-component blocks merge as validated top-level fields.
  Malformed decoded JSON / rows reject with `ValidationError`; remote
  and cache-only references remain explicit unsupported-reference reports
  without browser cache, Tauri, OPFS, AutoStorage, or repository fallback.
- Focused coverage in `server/fastify/__tests__/risuSaveCodec.test.ts`
  proves legacy normalization, block assembly, root-component merge
  behavior, unsupported-reference reports, malformed import rejection,
  and browser-storage / Tauri / Svelte / global compression-stream
  detachment.

## Immediate Pickup

Immediate pickup: **9-7e - Repository-backed export adapter**.

- Build export snapshots from server persistence with server asset ids
  preserved as references. Keep ZIP bundle generation, multipart routes,
  repository imports, command dispatch, event emission, and asset-byte
  walking deferred to 9-8.
- Use the production codecs and import-side shape reference in
  `server/fastify/src/risuSave/legacyEnvelopeCodec.ts`,
  `server/fastify/src/risuSave/blockCodec.ts`, and
  `server/fastify/src/risuSave/importSnapshot.ts`. Do not reopen
  envelope or block wire formats unless export parity exposes a real
  codec bug.
- Read persisted `db.json` through repository helpers, preserve current
  Phase 9 database shapes, and avoid browser-only defaults or Svelte
  database imports.
- Preserve server asset ids as references only. Asset reference walking
  and bundle export stay in 9-8c and 9-8d.
- Treat repository snapshots as current Phase 9 schema targets. Do not
  add compatibility migrations for intermediate Fastify shapes.

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

1. 9-7e - Repository-backed export adapter.
2. 9-8a - Multipart `.risu` import route.
3. 9-8b - Repository `.risu` export route.
4. 9-8c - Asset reference walker.
5. 9-8d - Bundle export route.
6. 9-9a - Server-backed browser smoke harness.
7. 9-9b - Generation and memory fixture closeout.
8. 9-9c - Server-backed storage-write audit.
9. 9-9d - Manual Fastify web and Tauri local verification.
10. 9-9e - Phase 9 docs closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for
  server-side string flattening.

## Verification

For the current 9-7e slice, start with focused server `.risu` coverage
and type checks:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts
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

Last recorded focused baseline after 9-7d:

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - 16 Fastify `.risu` codec / import snapshot tests passed.
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
  [`../phases-completed/phase-9-client-thinning-9-7d.md`](../phases-completed/phase-9-client-thinning-9-7d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
