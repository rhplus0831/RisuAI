# Prompt Template Ownership Cleanup Plan

Date: 2026-06-23

This active workstream plans the architectural cleanup for prompt template
ownership. It follows the investigation into whether legacy `botPresets` should
be read directly instead of copying `botPresets[].promptTemplate` into the active
top-level `DBState.db.promptTemplate`.

The cleanup direction is deliberately not "make legacy bot presets
authoritative." The target architecture is:

- Modern `promptPresets` own reusable prompt template data.
- `modelPresets` own model/runtime data.
- Legacy `botPresets` remain import/export and compatibility data.
- Top-level `promptTemplate` stops being the durable editing source. During the
  transition it may remain as an effective projection/cache for compatibility.

Start with [`status.md`](status.md), then read [`plan.md`](plan.md), then the
phase files under [`phases/`](phases/). [`latest-verification.md`](latest-verification.md)
records the current proof level.

## Read Order

1. [`status.md`](status.md) - current workstream state and phase router.
2. [`plan.md`](plan.md) - goal, target contract, non-goals, risks, and source
   anchors.
3. [`latest-verification.md`](latest-verification.md) - current validation
   state and gaps.
4. [`phases/README.md`](phases/README.md) - phase index and slice rules.
5. [`phases/phase-0-contract-and-decision.md`](phases/phase-0-contract-and-decision.md)
   - lock source-of-truth and compatibility decisions.
6. [`phases/phase-1-effective-template-resolver.md`](phases/phase-1-effective-template-resolver.md)
   - introduce shared effective prompt template resolution.
7. [`phases/phase-2-prompt-preset-commands-and-projection.md`](phases/phase-2-prompt-preset-commands-and-projection.md)
   - move prompt-item edits and hydration toward prompt-preset ownership.
8. [`phases/phase-3-settings-ui-and-bridge.md`](phases/phase-3-settings-ui-and-bridge.md)
   - update Prompt Settings and Bot Settings to edit the selected prompt preset.
9. [`phases/phase-4-legacy-botpreset-compatibility.md`](phases/phase-4-legacy-botpreset-compatibility.md)
   - retire legacy bot-preset template apply/copy semantics.
10. [`phases/phase-5-generation-loadout-and-cleanup.md`](phases/phase-5-generation-loadout-and-cleanup.md)
    - align generation, loadouts, tests, and remaining compatibility paths.
11. [`phases/phase-6-verification-and-docs.md`](phases/phase-6-verification-and-docs.md)
    - final regression, browser smoke, docs, and closeout.

## Source Inputs

- `STRUCTURE.md`
- `docs/structure/server-projection-and-bridges.md`
- `docs/structure/data-and-events.md`
- `docs/structure/providers-and-models.md`
- Exploration agents checked prompt assembly/runtime, server persistence and
  projection, and frontend settings/storage/loadout surfaces before this plan
  was written.

## Source Anchors

- Prompt assembly:
  - `server/fastify/src/prompt/assemble.ts`
  - `server/fastify/src/prompt/templates.ts`
  - `server/fastify/src/prompt/staticSections.ts`
  - `src/ts/process/promptAssembly/normalizeTemplate.ts`
  - `src/ts/process/sendChatPromptAssembly.ts`
- Preset contracts:
  - `src/ts/presetSplit.ts`
  - `server/fastify/src/commands/splitPresets.ts`
  - `server/fastify/src/commands/presets.ts`
  - `src/ts/storage/database.svelte.ts`
  - `src/ts/loadout.ts`
- Commands, projection, hydration:
  - `server/fastify/src/routes/commands.ts`
  - `server/fastify/src/routes/projection.ts`
  - `server/fastify/src/repository.ts`
  - `src/ts/server/commands.ts`
  - `src/ts/server/promptTemplateBridge.svelte.ts`
  - `src/ts/server/promptTemplateHydration.ts`
- Settings UI:
  - `src/lib/Setting/Pages/PromptSettings.svelte`
  - `src/lib/Setting/Pages/BotSettings.svelte`
  - `src/lib/Setting/botpreset.svelte`
  - `src/ts/presetFieldMirror.ts`
- Tests:
  - `server/fastify/__tests__/commandCollectionRange.test.ts`
  - `server/fastify/__tests__/bootstrap.test.ts`
  - `server/fastify/__tests__/projection.test.ts`
  - `src/ts/server/promptTemplateBridge.svelte.test.ts`
  - `src/ts/server/promptTemplateHydration.test.ts`
  - `src/ts/storage/database.svelte.test.ts`
  - `src/ts/loadout.test.ts`
