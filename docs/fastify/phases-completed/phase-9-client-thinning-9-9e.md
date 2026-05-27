# Phase 9-9e - Phase 9 Docs Closeout

Date: 2026-05-26

Phase 9 is closed for the Fastify-served web client-thinning scope. The browser
client now runs as a projection of server state in server-backed web mode:
durable mutations route through typed commands, projection refreshes come from
bootstrap/events, server-backed storage gates avoid local persistence writes,
provider secrets are masked in bootstrap, and server `.risu` import/export and
bundle routes own save movement.

Post-closeout audit note: direct-write follow-up slices reopened after this
closeout and later closed through 9J in
`docs/fastify/phases-completed/phase-9-client-thinning-followup.md`.

## Confirmed

- Command routes cover the Phase 9 resource families with revision conflicts,
  rollback/no-revision-bump behavior, mapped command events, and browser helper
  request shapes.
- Browser projection startup, command-event subscription, debounced
  re-bootstrap, and the read-only projection guard are covered by focused tests
  and the Fastify browser smoke.
- Server-backed web storage gates cover startup/save/backup maintenance, asset
  reads, RISUSAVE cache/remotes, cold-storage helpers, Google Search credential
  storage, and provider secret masking.
- Server `.risu` codec, multipart import, repository export, asset reporting,
  and bundle export are covered by focused Fastify API tests and exercised by
  the browser smoke where appropriate.
- Fastify-served web manual verification passed for import, chat/message
  persistence, regenerate replacement, message edit, character switch, settings
  mutation, projection refresh, reload persistence, and no IndexedDB/localForage
  or OPFS writes.

## Verification

The closeout uses the already-green 9-9d baseline:

```bash
pnpm smoke:fastify-browser
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/sendChatContext.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts
pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm check
pnpm tauribuild
pnpm test -- src/ts/storage/backup.test.ts src/ts/server/backups.test.ts
```

Results recorded in 9-9d:

- Browser smoke/storage audit passed.
- Server-backed sendChat fixture command selected 65 files, with 734 passing
  tests and 4 skipped.
- Focused memory/generation helpers passed 5 files and 56 tests.
- Focused server `.risu` codec/reference tests passed 2 files and 23 tests.
- Focused Fastify import/export/bootstrap command selected the full API suite,
  with 68 files and 1162 tests passing.
- `pnpm check` was clean.
- `pnpm tauribuild` passed with existing warnings.
- Focused local backup command selected 65 files, with 734 passing tests and 4
  skipped.

## Deferred

The legacy local client manual verification remains a separate later task. Do not rerun
or work around it as part of Phase 9 closeout; it is tracked independently from
the Fastify-served web migration scope.
