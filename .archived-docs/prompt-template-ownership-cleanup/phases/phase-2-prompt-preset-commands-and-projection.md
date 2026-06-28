# Phase 2: Prompt Preset Commands And Projection

Status: implemented.

Goal: make prompt-template write paths owner-aware, with modern prompt presets
as the normal owner.

## Scope

- Introduce prompt-preset-scoped prompt item commands or extend existing
  prompt-item commands with stable owner identity.
- Include `promptPresetId` in browser command wrappers and server request
  validation where prompt preset ownership is active.
- Update server mutations so row edits write `prompt_presets` rows instead of
  the top-level `prompt_templates` table for modern prompt preset editing.
- Preserve rollback behavior in the prompt-template bridge without cloning
  whole prompt-template arrays unnecessarily.
- Update projection/hydration so the editor can hydrate selected prompt preset
  bodies reliably.
- Decide whether `promptItem` projection becomes:
  - a derived active-prompt-preset projection,
  - a prompt-preset-body projection, or
  - a compatibility-only top-level projection.

## Out Of Scope

- Prompt Settings visual redesign.
- Legacy bot preset apply cleanup.
- Loadout migration.

## Anchors

- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`
- `src/ts/server/commands.ts`
- `src/ts/server/promptTemplateBridge.svelte.ts`
- `src/ts/server/promptTemplateHydration.ts`
- `src/ts/storage/database.svelte.ts`

## Exit Criteria

- Prompt item create/update/delete/reorder can target the selected prompt preset
  by stable id.
- A debounced edit is rejected or safely routed if prompt preset selection
  changes before the command reaches the server.
- Projection/hydration can load the selected prompt preset template without
  depending on top-level durable ownership.
- Existing bridge performance protections are retained or replaced with
  equivalent row-level behavior.

## Implementation Notes

- Existing prompt item endpoints now accept optional `promptPresetId`; no new
  endpoint names were added.
- Scoped prompt item edits validate that `promptPresetId` exists and still
  matches the selected `database.promptPresetsId`, then mutate
  `promptPresets[index].promptTemplate` and persist the owning
  `prompt_presets` row.
- Legacy top-level `prompt_templates` writes remain available when
  `promptPresetId` is omitted.
- `promptItem` projection derives the selected/requested prompt preset template
  and sends a null template sentinel when the owner has no template, allowing
  clients to clear stale compatibility projection.
- Browser hydration keys in-flight/completed state by prompt preset owner.
- The prompt-template bridge keys pending row edits by owner plus item id,
  sends the captured owner id, and drops stale owner edits if selection changes
  before debounce flush.

## Validation

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/promptTemplateHydration.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/projection.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

## Risks

- Whole-preset patching on every card edit can undo previous bridge performance
  work.
- Selection races are easy to miss because prompt edits are debounced.
- Projection resource changes can force broad bootstrap refreshes if not kept
  narrow.
