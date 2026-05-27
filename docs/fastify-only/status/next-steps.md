# Fastify-Only Next Steps

## Current Pickup

Start with [Phase 3: Storage Contract Cleanup](../phases/phase-3-storage-contract-cleanup.md). Phase 0, Phase 1, and Phase 2 are closed in [phases-completed](../phases-completed/).

## Immediate Tasks

1. Remove the legacy route table from `src/ts/storage/nodeStorage.ts` so storage uses `/api/v1/storage/*` and Fastify auth routes only.
2. Collapse `src/ts/storage/autoStorage.ts` so app persistence selects Fastify-backed storage instead of OPFS/localforage as a runtime alternative.
3. Update `src/ts/bootstrap.ts` so missing Fastify bootstrap data reports a Fastify error instead of entering local save-file initialization.
4. Keep proxy routing, hosted functions, service worker cleanup, and broader docs packaging for later phases unless Phase 3 directly exposes a dead branch.
5. Update this file after Phase 3 closes.

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
