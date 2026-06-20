# Phase 6: Verification And Cleanup

Status: not started.

Goal: close the workstream with focused regression, browser smoke, updated docs,
and explicit compatibility caveats.

## Scope

- Run the full focused validation matrix from `latest-verification.md`.
- Run both TypeScript checks.
- Run Fastify browser smoke with `pnpm dev:agent`.
- Confirm `pnpm dev:agent` is stopped after smoke.
- Update structure docs:
  - `docs/structure/providers-and-models.md`
  - `src/docs/svelte-ui.md`
  - `src/docs/client-runtime.md`
  - `STRUCTURE.md` if the plan folder should be referenced there
- Update this workstream's `status.md` and `latest-verification.md`.
- Record remaining compatibility surfaces:
  - legacy flat fields
  - compatibility profiles
  - unsupported provider placeholders
  - memory embeddings
  - Custom Models catalog

## Out Of Scope

- New provider support beyond the first-class set.
- Profile import/export UI.
- Retiring legacy DB fields.

## Validation

```bash
pnpm exec vitest run src/ts/model/modelProfileRecords.test.ts src/ts/model/modelProfileResolver.test.ts src/ts/model/modelProfileUiState.test.ts
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/server/commands.test.ts src/ts/loadout.test.ts src/ts/presetSplit.test.ts
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lang/index.test.ts
pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/generation.completion.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Run browser smoke:

```bash
pnpm dev:agent
```

Stop the dev server when done.

## Exit Criteria

- Focused tests pass or exact gaps are recorded.
- Browser smoke covers Settings -> Model Roles/Profiles, profile editing,
  conversion prompt, runtime defaults, and legacy compatibility panel.
- Docs describe the new profile-first model settings workflow.
- `status.md` marks the workstream complete only when the editor, conversion,
  commands, guardrails, and docs are all done.

