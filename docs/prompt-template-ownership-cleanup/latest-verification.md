# Latest Verification

Date: 2026-06-23

This workstream is currently planning-only. No implementation changes have been
made and no focused validation commands have been run for it yet.

## Current Proof

- Source exploration completed.
- Plan folder created under `docs/prompt-template-ownership-cleanup`.
- No runtime, command, projection, UI, or test changes have landed.

## Recommended Phase 0 Validation

Phase 0 is mostly contract/test-prep work. If source docs or tests are touched,
run the narrow checks relevant to those files plus formatting checks:

```bash
pnpm exec vitest run src/ts/presetSplit.test.ts src/ts/storage/database.svelte.test.ts src/ts/loadout.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/projection.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

## Future Browser Smoke

Use `pnpm dev:agent` when a phase changes the live settings workflow. Stop the
dev server after smoke so ports `6418` and `6419` are released.

Smoke targets:

- `http://localhost:6418/settings`
- Settings -> Prompt template editor
- Settings -> Bot/Prompt preset picker flows
- Loadout apply path that changes prompt preset selection

## Verification Gaps

- No implementation verification yet.
- No browser smoke yet.
- No test suite has been updated for the new ownership contract.
