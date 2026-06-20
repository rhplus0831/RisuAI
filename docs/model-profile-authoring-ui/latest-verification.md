# Latest Verification

Date: 2026-06-20

No implementation verification has been run for this workstream yet. The current
proof level is planning and read-only exploration only.

## Current Proof

- Read `STRUCTURE.md`.
- Read `.archived-docs/model-config-profiles/` root and phase docs.
- Read [`../model-profile-ui-ux-decisions.md`](../model-profile-ui-ux-decisions.md).
- Ran read-only exploration across:
  - durable profile data/resolver surfaces
  - command/persistence/masking surfaces
  - Settings -> Model Svelte UI surfaces
  - provider dispatch/preflight surfaces
- Created this plan folder from those findings.

## Commands To Run As Phases Land

Start focused, then broaden:

```bash
pnpm exec vitest run src/ts/model/modelProfileRecords.test.ts src/ts/model/modelProfileResolver.test.ts src/ts/model/modelProfileUiState.test.ts
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/server/commands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lang/index.test.ts
pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/generation.completion.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Use `pnpm dev:agent` for browser smoke after the UI is wired, and stop it
before finishing.

## Verification Gaps

- No schema changes have been implemented.
- No profile row commands have been implemented.
- No UI changes have been implemented.
- No generation guardrails have been implemented.
- No tests have been run for this workstream.

