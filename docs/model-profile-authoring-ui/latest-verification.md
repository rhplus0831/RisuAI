# Latest Verification

Date: 2026-06-20

Phase 6 has closed the workstream. The current proof level is
schema/default/preservation/masking coverage, resolver runtime/status coverage,
profile command/conversion coverage, projection refresh coverage, generation
preflight regression coverage, Settings -> Model shell coverage, browser smoke,
profile editor provider/runtime/fallback coverage, Custom API optional-auth
dispatch coverage, active durable-profile generation guardrail coverage, server
chat profile-runtime overlay coverage, structure/runtime doc refresh, final
focused regression, TypeScript checks, and `git diff --check`.

## Current Proof

- Phase 0 contract/schema implementation completed.
- Phase 1 resolver/runtime/status implementation completed.
- Phase 2 profile command/conversion implementation completed.
- Phase 3 Settings -> Model shell implementation completed.
- Phase 4 profile editor providers implementation completed.
- Phase 5 generation guardrails implementation completed.
- Phase 6 verification/docs closeout completed.
- Focused schema, defaults, masking, settings command, preset, loadout, and
  resolver regression suites passed.
- Focused resolver, UI-state, provider-capability, model role routing, server
  prompt assembly, and durable generation regression suites passed.
- Focused client command wrapper, Fastify command, provider-secret, projection,
  and route-protection suites passed.
- Focused Settings -> Model shell, role/profile list source contracts, and
  language fallback suites passed.
- Focused profile editor, provider panel, runtime defaults/overrides, fallback
  editor, secret placeholder, OpenAI optional-auth, and dispatch suites passed.
- Focused browser request/provider/preflight guardrail suites passed.
- Focused Fastify completion, chat generation, and dispatch guardrail suites
  passed, including bad active durable profiles before SSE/job/provider
  dispatch and Custom API optional-auth preservation.
- Client-lib TypeScript and strict Fastify TypeScript checks passed.
- `git diff --check` passed.
- Browser smoke passed for `/settings/model`, including Roles/Profiles tab
  rendering and the Profiles fallback count column.
- Browser smoke passed for the profile editor drawer on desktop and mobile,
  including provider panel switching, runtime defaults edit mode, Custom API
  `/chat/completions` warning, and dirty-close confirmation.
- Final Phase 6 browser smoke passed against `pnpm dev:agent` with a temp data
  dir. It covered the legacy conversion prompt, Not Now declined notice,
  Advanced Legacy Settings, Convert to Profiles, role binding render, Runtime
  Defaults edit/save, Custom API profile creation with suffix warning, binding
  Main Chat to the created profile, Apply/no-unsaved state, and reopening the
  legacy compatibility panel. The dev server was stopped after smoke.

## Final Commands Run

All commands passed on 2026-06-20:

```bash
pnpm exec vitest run src/ts/model/modelProfileRecords.test.ts src/ts/model/modelProfileResolver.test.ts src/ts/model/modelProfileUiState.test.ts
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/server/commands.test.ts src/ts/loadout.test.ts src/ts/presetSplit.test.ts
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lang/index.test.ts
pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts src/ts/process/request/tests/serverPromptAssembly.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

Browser smoke was run with:

```bash
RISU_API_DATA_DIR="$(mktemp -d)" pnpm dev:agent
```

Smoke target: `http://localhost:6418/settings/model`.

## Verification Gaps

- No Phase 6 closeout gaps. The final smoke was scripted/manual against the
  full-stack dev server rather than added as a committed Playwright spec.
- Browser smoke still does not exhaustively save every first-class provider
  shape; focused source/server tests cover those save-shape contracts.
