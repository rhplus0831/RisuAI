# Phase 6: Verification And Cleanup

Status: completed.

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

Final commands run on 2026-06-20:

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

Run browser smoke:

```bash
RISU_API_DATA_DIR="$(mktemp -d)" pnpm dev:agent
```

Stop the dev server when done.

## Closeout Results

- Focused validation matrix passed. The final run used the complete command
  matrix recorded in [`../latest-verification.md`](../latest-verification.md),
  including `serverPromptAssembly.test.ts`,
  `chatDispatchProfileOptions.test.ts`, both TypeScript checks, and
  `git diff --check`.
- Browser smoke passed against `http://localhost:6418/settings/model` using a
  temp data dir. It covered the conversion prompt, Not Now flow, Advanced
  Legacy Settings, Convert to Profiles, Runtime Defaults edit/save, Custom API
  profile create/save with `/chat/completions` warning, Main Chat role binding
  to the created profile, Apply/no-unsaved state, and reopening Advanced Legacy
  Settings.
- `pnpm dev:agent` was stopped after smoke; ports `6418` and `6419` were free.
- Structure docs and workstream docs now describe Settings -> Model as
  profile-first and record canonical compatibility caveats.

## Exit Criteria

- Focused tests passed.
- Browser smoke covered Settings -> Model Roles/Profiles, profile editing,
  conversion prompt, runtime defaults, and legacy compatibility panel.
- Docs describe the profile-first model settings workflow.
- `status.md` marks the workstream complete because the editor, conversion,
  commands, guardrails, verification, smoke, and docs are done.
