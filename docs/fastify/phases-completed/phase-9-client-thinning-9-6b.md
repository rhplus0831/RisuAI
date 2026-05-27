# Phase 9-6b - Asset Byte Gate

Date: 2026-05-26

Status: complete.

## Summary

- Fastify-mode `loadAsset()` now reads through the server asset API instead
  of falling through to local web storage.
- `readImage()` and `loadAsset()` share the same Fastify byte reader, which
  resolves raw server asset ids and legacy `assets/<sha>.<ext>` references to
  `/api/v1/assets/:id`.
- Legacy local mode asset reads remain on their existing local storage
  paths.
- Durable asset references remain owned by the existing 9-4d command paths;
  no bundle walking, repository-backed `.risu` import/export, backup/restore
  projection, residual cache classification, or provider secret masking work
  was folded into this slice.

## Verification

- `pnpm test src/ts/server/assets.test.ts`
  - 3 tests passed.
- `pnpm test src/ts/bootstrap.test.ts src/ts/server/assets.test.ts`
  - 10 tests passed.
- `pnpm api:test server/fastify/__tests__/assets.test.ts`
  - 14 tests passed.

Observed during verification:

- `pnpm test src/ts/process/__tests__/orchestrateResponse.test.ts` fails
  with two existing `currentChat` object-identity assertions. The failure
  reproduces when that suite is run by itself and is not part of the
  asset-byte helper surface.

## Follow-Up

Continue with **9-6c - Server backup/restore projection**. Route
server-backed backup UI/helper paths through `/api/v1/backups`, block local
backup/restore in Fastify mode, and emit/handle restore invalidation.
