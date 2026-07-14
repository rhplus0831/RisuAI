# Model Config Profiles Plan

Date: 2026-06-19

This open workstream plans a structural refactor of model selection and
provider/runtime options. The goal is to replace the current flattened model
settings surface with reusable model configuration profiles: each profile owns a
selected model plus the options needed to call that model, and model roles point
to profiles.

The plan is grounded in the current Fastify provider dispatch and settings
shape. Start with [`status.md`](status.md), then read [`plan.md`](plan.md), then
the phase files under [`phases/`](phases/). [`latest-verification.md`](latest-verification.md)
records the current proof level and the commands future implementation agents
should run as phases land.

## Read Order

1. [`status.md`](status.md) - current phase router and open workstream state.
2. [`plan.md`](plan.md) - goal, target contract, invariants, and non-goals.
3. [`latest-verification.md`](latest-verification.md) - current validation
   proof and remaining proof.
4. [`phases/README.md`](phases/README.md) - phase index.
5. [`phases/phase-0-current-contracts.md`](phases/phase-0-current-contracts.md)
   - freeze current role, provider, preset, fallback, and masking behavior.
6. [`phases/phase-1-read-only-profile-resolver.md`](phases/phase-1-read-only-profile-resolver.md)
   - introduce a derived resolver while storage stays flat.
7. [`phases/phase-2-preset-composition.md`](phases/phase-2-preset-composition.md)
   - centralize effective model settings composition.
8. [`phases/phase-3-generation-dispatch.md`](phases/phase-3-generation-dispatch.md)
   - move browser/server generation dispatch to the derived resolver contract.
9. [`phases/phase-4-ui-and-command-adapter.md`](phases/phase-4-ui-and-command-adapter.md)
   - adapt role/profile UI and settings commands while writes still target
     existing fields.
10. [`phases/phase-5-custom-secrets-and-auxiliary.md`](phases/phase-5-custom-secrets-and-auxiliary.md)
    - harden custom models, secret masking, memory, fallback, and auxiliary
      surfaces.
11. [`phases/phase-6-persisted-profiles.md`](phases/phase-6-persisted-profiles.md)
    - add durable reusable profiles after resolver and dispatch parity are
      proven.
12. [`phases/phase-7-verification-and-cleanup.md`](phases/phase-7-verification-and-cleanup.md)
    - closeout regression, documentation updates, compatibility cleanup, and
      TypeScript proof.

## Sub-Agent Inputs

This plan incorporates prior broad exploration of the model/provider surface and
two follow-up sub-agent passes requested for planning accuracy:

- A document-structure explorer verified the folder should mirror
  `../user-input-state-hardening/` at the root-file and phase-file level, while
  keeping this plan open and concise.
- A model/provider phase explorer recommended the main sequencing correction:
  derive and adopt a read-only profile resolver first, then persist reusable
  profile records only after runtime behavior and UI adaptation are proven.
- A final audit/polish explorer caught the preset-before-dispatch ordering and
  secret-masking boundary issues; this draft incorporates those corrections.

## Source Anchors

- Structure and provider docs:
  - [`../../../STRUCTURE.md`](../../../STRUCTURE.md)
  - [`../../../docs/structure/providers-and-models.md`](../../../docs/structure/providers-and-models.md)
  - [`../../../src/docs/svelte-ui.md`](../../../src/docs/svelte-ui.md)
  - [`../../../docs/structure/server-resources-and-bridges.md`](../../../docs/structure/server-resources-and-bridges.md)
- Model role and registry:
  - `src/ts/model/modelRoles.ts`
  - `src/ts/model/modellist.ts`
  - `src/ts/model/types.ts`
  - `src/lib/UI/ModelList.svelte`
  - `src/lib/UI/ModelGrid.svelte`
- Settings UI:
  - `src/lib/Setting/Pages/Model/ModelRoleList.svelte`
  - `src/lib/Setting/Pages/BotSettings.svelte`
  - `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte`
  - `src/lib/Setting/Pages/PromptSettings.svelte`
  - `src/lib/Others/AllSeperateParameters.svelte`
- Settings persistence and presets:
  - `src/ts/storage/database.svelte.ts`
  - `server/fastify/src/databaseDefaults.ts`
  - `server/fastify/src/routes/commands.ts`
  - `server/fastify/src/providerSecrets.ts`
  - `src/ts/presetSplit.ts`
  - `server/fastify/src/commands/splitPresets.ts`
  - `src/ts/loadout.ts`
- Runtime dispatch:
  - `src/ts/process/request/request.ts`
  - `src/ts/process/request/shared.ts`
  - `src/ts/process/request/providerCapability.ts`
  - `src/ts/process/request/serverPromptAssembly.ts`
  - `server/fastify/src/routes/generation.ts`
  - `server/fastify/src/prompt/chatDispatch.ts`
  - `server/fastify/src/memorySummaryModel.ts`
  - `server/fastify/src/memoryEmbeddingModel.ts`

For current repo navigation, read [`../../../STRUCTURE.md`](../../../STRUCTURE.md)
and the focused files under [`../../../docs/structure/`](../../../docs/structure/).
