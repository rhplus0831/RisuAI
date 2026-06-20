# Model Profile Authoring UI Plan

Date: 2026-06-20

This open workstream plans the visible Durable Profile authoring UI and the
supporting contract changes required to make that UI real. It follows the
closed `.archived-docs/model-config-profiles/` workstream, which added durable
profile storage, role bindings, resolver adoption, provider dispatch support,
compatibility preservation, and resolved-profile summaries, but intentionally
deferred a full visible editor.

The goal here is to make Settings -> Model profile-first:

- Roles bind to reusable Durable Profiles or inherit from source roles.
- Profiles own provider/model credentials, request model, runtime overrides,
  fallbacks, and first-class provider configuration.
- Runtime Defaults become explicit durable profile-system defaults.
- Legacy flat settings remain compatible data, but stop being the normal
  profile-backed UI workflow.

Start with [`status.md`](status.md), then read [`plan.md`](plan.md), then the
phase files under [`phases/`](phases/). [`latest-verification.md`](latest-verification.md)
records the current proof level as phases land. [`../model-profile-ui-ux-decisions.md`](../model-profile-ui-ux-decisions.md)
is the design decision log this plan is based on.

## Read Order

1. [`status.md`](status.md) - current phase router and open workstream state.
2. [`plan.md`](plan.md) - goal, target contract, invariants, non-goals, risks.
3. [`latest-verification.md`](latest-verification.md) - current validation
   proof and remaining proof.
4. [`phases/README.md`](phases/README.md) - phase index and slice rules.
5. [`phases/phase-0-contract-and-schema.md`](phases/phase-0-contract-and-schema.md)
   - expand durable profile records, defaults, secrets, and runtime defaults.
6. [`phases/phase-1-resolver-runtime-status.md`](phases/phase-1-resolver-runtime-status.md)
   - make provider-first resolution and profile status semantics explicit.
7. [`phases/phase-2-profile-commands-and-conversion.md`](phases/phase-2-profile-commands-and-conversion.md)
   - add atomic profile commands and legacy-to-profile conversion.
8. [`phases/phase-3-settings-model-shell.md`](phases/phase-3-settings-model-shell.md)
   - build Roles/Profiles tabs, conversion prompt, and compatibility panel.
9. [`phases/phase-4-profile-editor-providers.md`](phases/phase-4-profile-editor-providers.md)
   - implement the full editor for OpenAI, Anthropic, Google, Vertex, Custom
     API, runtime defaults, and fallbacks.
10. [`phases/phase-5-generation-guardrails.md`](phases/phase-5-generation-guardrails.md)
    - block incomplete/unsupported active profiles in browser and server paths.
11. [`phases/phase-6-verification-and-cleanup.md`](phases/phase-6-verification-and-cleanup.md)
    - final regression, browser smoke, docs, and compatibility cleanup notes.

## Source Inputs

- [`../model-profile-ui-ux-decisions.md`](../model-profile-ui-ux-decisions.md)
  captures locked product and UX decisions.
- `.archived-docs/model-config-profiles/` captures the completed durable
  profile runtime workstream and deferred work.
- Exploration agents checked data/resolver, command/persistence, UI, and
  dispatch/preflight surfaces before this plan was written.

## Source Anchors

- Structure and docs:
  - [`../../STRUCTURE.md`](../../STRUCTURE.md)
  - [`../structure/providers-and-models.md`](../structure/providers-and-models.md)
  - [`../../src/docs/svelte-ui.md`](../../src/docs/svelte-ui.md)
  - [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md)
- Durable profile data and resolver:
  - `src/ts/model/modelProfileRecords.ts`
  - `src/ts/model/modelProfileResolver.ts`
  - `src/ts/model/modelProfileUiState.ts`
  - `src/ts/model/modelRoles.ts`
  - `src/ts/storage/database.svelte.ts`
  - `server/fastify/src/databaseDefaults.ts`
- Commands, masking, projection:
  - `src/ts/server/commands.ts`
  - `server/fastify/src/routes/commands.ts`
  - `server/fastify/src/commands/`
  - `server/fastify/src/providerSecrets.ts`
  - `server/fastify/src/routes/bootstrap.ts`
  - `server/fastify/src/routes/projection.ts`
- Settings UI:
  - `src/lib/Setting/Pages/BotSettings.svelte`
  - `src/lib/Setting/Pages/Model/ModelRoleList.svelte`
  - `src/lib/Setting/Pages/Model/ModelRoleEditor.svelte`
  - `src/lib/Setting/Pages/Model/`
  - `src/ts/setting/botSettingsParamsData.ts`
  - `src/lang/*`
- Runtime and dispatch:
  - `src/ts/process/request/providerCapability.ts`
  - `src/ts/process/request/serverPromptAssembly.ts`
  - `src/ts/process/request/request.ts`
  - `server/fastify/src/routes/generation.ts`
  - `server/fastify/src/routes/generationChat.ts`
  - `server/fastify/src/prompt/chatDispatch.ts`
  - `server/fastify/src/generation/openai.ts`

