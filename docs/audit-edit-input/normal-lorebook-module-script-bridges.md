# Lorebook, Module, Script, Trigger, And Prompt Template Bridges Audit

Date: 2026-06-16

Status: normal

## Scope

Verified global/character/module lorebook edits, module regex/trigger edits,
script definition bridges, trigger draft propagation, and prompt-template
hydration/bridge behavior.

## Result

The current bridge paths work correctly. Older module lorebook/script draft
holes appear fixed. Character lorebook hydration gating is a no-data-loss guard,
not a persistence bug.

## Evidence

- `src/lib/Setting/Pages/Module/ModuleMenu.svelte:129` routes module lorebook
  add/import through `updateModuleLorebookCollection()`.
- `src/ts/server/lorebookBridge.svelte.ts:546` normalizes entry ids, updates
  live and draft module state, and dispatches when the module exists.
- `src/lib/Setting/Pages/Module/ModuleMenu.svelte:65` and `:85` snapshot nested
  regex/trigger drafts and route changes through the bridge.
- `src/ts/server/scriptDefinitionBridge.svelte.ts:164` assigns ids, updates
  live/draft rows, and dispatches module script/trigger replacements.
- `src/ts/server/lorebookBridge.svelte.ts:90` prevents non-hydrated character
  lorebook stubs from being persisted as deletes.
- `src/ts/server/promptTemplateHydration.ts:30` and
  `src/ts/server/promptTemplateBridge.svelte.ts:83` keep unloaded prompt
  templates from being written as empty state.

## Verification

Verification agent and main-agent tests passed:

- `pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/lorebookBridge.test.ts src/ts/server/chatMessageHydration.test.ts`
- `pnpm exec vitest run src/ts/server/scriptDefinitionBridge.svelte.test.ts src/ts/stores.modulesEffect.svelte.test.ts src/ts/process/triggers.cloneCost.test.ts`
- `pnpm exec vitest run src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/promptTemplateHydration.test.ts src/ts/process/__tests__/sendChatPromptAssembly.lazyPromptTemplate.test.ts src/ts/process/request/tests/serverChat.test.ts`
- `pnpm api:test __tests__/projection.test.ts __tests__/lorebook.test.ts __tests__/modules.test.ts`
- `pnpm api:test __tests__/commands.test.ts`

Residual coverage gap: no full mounted `TriggerV2List` test simulates a modal
field edit, but helper/source coverage and bridge tests support the normal
classification.
