# Fastify-Only Next Steps

## Current Pickup

Continue [Phase 3: Storage Contract Cleanup](../phases/phase-3-storage-contract-cleanup.md). Phase 3A client storage route collapse and Phase 3B local app persistence selection are complete; the next pickup is Phase 3C bootstrap fallback cleanup.

## Immediate Tasks

1. Phase 3A done on 2026-05-27: `src/ts/storage/nodeStorage.ts` now uses `/api/v1/storage/*` plus `/api/v1/auth/*` only, and `src/ts/storage/nodeStorage.test.ts` covers the retained client route contract.
2. Phase 3B done on 2026-05-27: `src/ts/storage/autoStorage.ts` now selects Fastify-backed `NodeStorage` only, `src/ts/storage/opfsStorage.ts` is removed, and `src/ts/storage/autoStorage.test.ts` covers the retained selector contract.
3. Update `src/ts/bootstrap.ts` so missing Fastify bootstrap data reports a Fastify error instead of entering local save-file initialization.
4. Keep proxy routing, hosted functions, service worker cleanup, and broader docs packaging for later phases unless Phase 3 directly exposes a dead branch.
5. Update this file after the next Phase 3 slice closes.

## Latest Phase 3B Verification

- `pnpm exec vitest run src/ts/storage/autoStorage.test.ts src/ts/storage/nodeStorage.test.ts src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts` passed: 4 files and 16 tests.
- `pnpm check` passed.
- `pnpm test` passed: 74 files, 768 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings.

## Phase 3 Verification To Record

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## Watch Points

- Phase 2 removed `globalThis.__NODE__`; do not reintroduce it to make storage selection work.
- Keep Phase 3 focused on storage and bootstrap persistence contracts.
- Include localized app strings in the docs and packaging closeout, not only markdown files.
- Treat newly discovered proxy or browser-local surfaces as follow-up findings unless they block storage cleanup.
