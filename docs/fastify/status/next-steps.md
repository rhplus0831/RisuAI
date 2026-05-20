# Next Steps

Date: 2026-05-20

Use this list to pick the next slice. Keep work batches narrow:
one proxy slice or one characterization-test slice at a time.

## Immediate

1. **Phase 3 - Proxy migration.** Port provider proxy, hub
   passthrough, and stream-job WebSocket behavior from
   `server/node/server.cjs` to Fastify.
   - Keep the existing client contracts (`/proxy*`,
     `/hub-proxy/*`, `/proxy-stream-jobs`) working until the
     Fastify replacements are wired.
   - Do not port Sionyw / Account Sync branches; Phase 0 removed
     them.
   - Inventory and exit criteria live in
     [`../phases/phase-3-proxy.md`](../phases/phase-3-proxy.md).

2. **Phase 4 prep - characterization tests.**
   - Build the fixture loader that drives the current `sendChat`
     against canned databases + canned upstream responses.
   - Do not modify `sendChat` itself. The goal is to record what
     the function does today before Phase 5 extraction changes its
     structure.
   - Inventory lives in
     [`../coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md).

## Completed Slices

- **Phase 0 removals - Group chat.** Done 2026-05-20. Single
  commit; the type narrowing forced types, runtime, and UI to
  land together. `isGroupChat` was preserved as a `false`
  back-compat shim for user scripts. See [`removals.md`](removals.md)
  for the as-landed inventory.

- **Phase 0 removals - Peer multi-user chat.** Done 2026-05-20.
  See [`removals.md`](removals.md) for the as-landed inventory.

- **Phase 0 removals - Risu Account Sync + Drive sync.** Done
  2026-05-20. Landed as a single commit. The `backuplocal.ts`
  helpers were preserved (moved to `src/ts/storage/backup.ts`) so
  the in-app local backup buttons keep working; the doc claim that
  those helpers "rode alongside the Drive code path" turned out to
  be wrong. See [`removals.md`](removals.md) for the as-landed
  inventory.

- **Phase 0 removals - Legacy memory engines.** Done 2026-05-20.
  Two commits: V3 decoupling (rename `supaMemoryKey` →
  `hypaV3Key` with migration fallback), then the bulk removal.
  See [`removals.md`](removals.md) for the as-landed inventory.

- **Phase 1 - Fastify foundation.** Done 2026-05-20. Adds
  `server/fastify/` with `config.ts`, `db.ts` (`node:sqlite` +
  `schema_version`), `auth.ts`, `http.ts`, health/auth routes,
  root `pnpm api:*` scripts, Vite `/api` dev proxy, and a vitest
  smoke harness.

- **Phase 2 - Server storage, import, assets, backups.** Done
  2026-05-20. Adds `GET /api/v1/bootstrap`, JSON
  `POST /api/v1/import/risusave`, raw asset upload/read/head/exists
  routes, backup create/list/restore/delete routes, static serving
  from `RISU_API_STATIC_ROOT`, and the Docker switch to Fastify on
  port 6002. No server-side `.risu` export/bundle or asset delete
  route exists in Phase 2.

## Closed (do not reopen without a contract)

These choices are locked. Reopening means writing a short rationale
in this file and updating the relevant phase doc:

- Tauri stays as-is. Do not add or modify Tauri-specific code in
  Phase 0-9.
- Hub proxy stays. Do not delete `/hub-proxy/*` handling.
- No whole-state PUT in the Fastify API.
- Only Hypa V3 survives. Do not write code that re-introduces
  Supa / Hypa V2 / Hanurai.

## Verification before closing a slice

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Tauri build is verified manually at phase boundaries, not
per-slice.
