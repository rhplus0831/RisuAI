# Agent Preset Plan

Date: 2026-07-05

This completed workstream expands [`../agent-preset-plan.md`](../agent-preset-plan.md)
from product Q&A into the implementation plan that replaced the legacy Context
Agent feature with Agent Presets.

The delivered result makes auxiliary agents a chat-generation orchestration
layer:

- Chats may select an Agent Preset in addition to persona, model preset, and
  prompt preset.
- Agent Presets contain before-main and after-main agent steps.
- Before-main outputs are named and can be referenced from prompts with
  `{{agent::name}}`.
- After-main steps run after the existing `editOutput` pass and before the
  existing Lua `onOutput` trigger.
- Context Agent settings, `{{agent}}`, and `{{slot::agent}}` are removed from
  the user-facing model.
- No Context Agent migration is planned for the first release.

Start with [`status.md`](status.md), then read [`plan.md`](plan.md), then the
phase files under [`phases/`](phases/). [`latest-verification.md`](latest-verification.md)
records the current proof level. The phase file names intentionally mirror
`.archived-docs/model-profile-authoring-ui/`; their contents are Agent
Preset-specific.

## Read Order

1. [`status.md`](status.md) - current state, blockers, phase router, and
   compatibility caveats.
2. [`plan.md`](plan.md) - goal, target contract, invariants, non-goals,
   risks, and implementation boundaries.
3. [`latest-verification.md`](latest-verification.md) - current validation
   proof for this workstream.
4. [`phases/README.md`](phases/README.md) - phase index and slice rules.
5. [`phases/phase-0-contract-and-schema.md`](phases/phase-0-contract-and-schema.md)
   - define Agent Preset records, step schema, chat selection, and defaults.
6. [`phases/phase-1-resolver-runtime-status.md`](phases/phase-1-resolver-runtime-status.md)
   - add preset resolution, DAG planning, prepared-input planning, and status
   helpers.
7. [`phases/phase-2-profile-commands-and-conversion.md`](phases/phase-2-profile-commands-and-conversion.md)
   - add command/projection surfaces and explicit no-migration cleanup for
   Context Agent data.
8. [`phases/phase-3-settings-model-shell.md`](phases/phase-3-settings-model-shell.md)
   - build the visible Settings and chat-selection shell for Agent Presets.
9. [`phases/phase-4-profile-editor-providers.md`](phases/phase-4-profile-editor-providers.md)
   - implement the full step editor and prepared-input execution support.
10. [`phases/phase-5-generation-guardrails.md`](phases/phase-5-generation-guardrails.md)
    - integrate before-main/after-main execution into generation, tracing, and
    guardrails.
11. [`phases/phase-6-verification-and-cleanup.md`](phases/phase-6-verification-and-cleanup.md)
    - removed legacy Context Agent surfaces, updated docs, and ran closeout
    verification.

## Source Inputs

- [`../agent-preset-plan.md`](../agent-preset-plan.md) captures the original
  product Q&A and agreed alignment answers.
- `.archived-docs/model-profile-authoring-ui/` provides the folder and file
  skeleton only.
- Current structure notes:
  - [`../../STRUCTURE.md`](../../STRUCTURE.md)
  - [`../structure/backend.md`](../structure/backend.md)
  - [`../structure/providers-and-models.md`](../structure/providers-and-models.md)
  - [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md)
  - [`../../src/docs/svelte-ui.md`](../../src/docs/svelte-ui.md)

## Source Anchors

- Removed legacy Context Agent cleanup/regression anchors:
  - `server/fastify/src/prompt/assemble.ts`
  - `server/fastify/__tests__/assemble.test.ts`
  - `server/fastify/__tests__/commands.test.ts`
  - `src/ts/router.ts`
  - `src/ts/router.test.ts`
  - `src/ts/cbs.ts`
  - `src/lang/*`
- Deleted legacy files, retained here only as historical references:
  - `server/fastify/src/prompt/contextAgent.ts`
  - `server/fastify/__tests__/contextAgent.test.ts`
  - `src/lib/Setting/Pages/ContextAgentSettings.svelte`
  - `src/ts/setting/contextAgentSettingsData.ts`
- Prompt assembly and generation:
  - `server/fastify/src/prompt/assemble.ts`
  - `server/fastify/src/prompt/templates.ts`
  - `server/fastify/src/prompt/variables.ts`
  - `server/fastify/src/prompt/effectiveGenerationConfig.ts`
  - `server/fastify/src/routes/generationChat.ts`
  - `server/fastify/src/prompt/sseEvents.ts`
  - `src/ts/process/request/serverChat.ts`
  - `src/ts/process/serverBackedSendChat.ts`
- Model/runtime selection:
  - `src/ts/model/modelProfileRecords.ts`
  - `src/ts/model/modelProfileResolver.ts`
  - `src/ts/model/modelRoles.ts`
  - `server/fastify/src/prompt/chatDispatch.ts`
  - `server/fastify/src/generation/`
- Chat selection, commands, projection, loadouts:
  - `src/ts/agentPresetRecords.ts`
  - `src/ts/agentPresetResolver.ts`
  - `src/ts/agentPresets.ts`
  - `server/fastify/src/commands/agentPresets.ts`
  - `src/ts/chatGenerationSettings.ts`
  - `src/ts/activeChatGenerationSettings.ts`
  - `src/lib/SideBars/ChatGenerationSettingsControls.svelte`
  - `src/ts/loadout.ts`
  - `server/fastify/src/commands/chats.ts`
  - `server/fastify/src/commands/loadouts.ts`
  - `server/fastify/src/routes/commands.ts`
  - `src/ts/server/commands.ts`
- Settings UI:
  - `src/lib/Setting/Settings.svelte`
  - `src/lib/Setting/Pages/`
  - `src/ts/setting/`
  - `src/lang/*`
