# Phase 9-6a - Server-Backed Persistence Gate

Date: 2026-05-26

Status: complete.

## Summary

- Fastify-served startup now skips local cold-storage maintenance and the
  browser save loop after loading the server bootstrap projection.
- `saveDb()`, `getDbBackups()`, and `makeColdData()` now return before
  initializing or writing AutoStorage, OPFS, NodeStorage, or localForage in
  Fastify mode.
- Legacy local mode startup, save, and backup maintenance paths remain
  unchanged.
- No asset-byte gating, server backup/restore projection, residual cache
  classification, provider secret masking, or server `.risu` codec work was
  folded into this slice.

## Verification

- `pnpm exec vitest run src/ts/bootstrap.test.ts`
  - 7 tests passed.

## Follow-Up

Continue with **9-6b - Asset byte gate**. Close remaining Fastify
asset-helper gaps, especially reads that can still fall through to local
storage, while keeping durable asset references on existing 9-4d commands
and leaving bundle walking for 9-8.
