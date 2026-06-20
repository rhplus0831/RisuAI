# Latest Verification

Date: 2026-06-20

Phase 3 has landed and passed focused verification. The current proof level is
schema/default/preservation/masking coverage, resolver runtime/status coverage,
profile command/conversion coverage, projection refresh coverage, generation
preflight regression coverage, Settings -> Model shell coverage, browser smoke,
and TypeScript checks.

## Current Proof

- Phase 0 contract/schema implementation completed.
- Phase 1 resolver/runtime/status implementation completed.
- Phase 2 profile command/conversion implementation completed.
- Phase 3 Settings -> Model shell implementation completed.
- Focused schema, defaults, masking, settings command, preset, loadout, and
  resolver regression suites passed.
- Focused resolver, UI-state, provider-capability, model role routing, server
  prompt assembly, and durable generation regression suites passed.
- Focused client command wrapper, Fastify command, provider-secret, projection,
  and route-protection suites passed.
- Focused Settings -> Model shell, role/profile list source contracts, and
  language fallback suites passed.
- Client-lib TypeScript and strict Fastify TypeScript checks passed.
- Browser smoke passed for `/settings/model`, including Roles/Profiles tab
  rendering and the Profiles fallback count column.

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

Use `pnpm dev:agent` for browser smoke after UI changes, and stop it before
finishing.

## Verification Gaps

- Full provider editor panels have not been implemented.
- Runtime defaults and fallback editors have not been implemented.
- No generation guardrails have been implemented.
