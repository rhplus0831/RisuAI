# Phase 2: Dirty Draft Projection

Status: pending.

Goal: prevent server projection, hydration, and successful command reconciliation
from reseeding local drafts that changed after the request began.

## Scope

- Add dirty-field tracking and projection merge behavior for character drafts.
- Apply the same pattern to prompt settings/items, personas, translator
  presets, global regex/settings drafts, lorebook entries, script/trigger
  definitions, module drafts, and plugin argument/storage editors.
- Clear dirty fields only when the matching command succeeds for the same
  target and attempted value, or when the user intentionally discards/reloads.
- Ensure successful projection for one field can still refresh clean sibling
  fields.

## Anchors

- `src/ts/server/characterBridge.svelte.ts`
- `src/lib/SideBars/CharConfig.svelte`
- `src/lib/Setting/botpreset.svelte`
- `src/lib/UI/PromptDataItem.svelte`
- `src/lib/Setting/listedPersona.svelte`
- `src/lib/Setting/lorepreset.svelte`
- `src/lib/Setting/Pages/Module/`
- `src/ts/plugins/`
- `src/ts/server/projection.ts`, `src/ts/server/projectionResync.ts`, and
  related hydration/reconcile helpers.

## Target Shape

- Character profile and nested character draft fields are protected from the
  `CharacterProjectionDirtyGap` found across the character editor audit.
- Prompt item creation, deletion, reorder, and field edits do not lose newer
  unsent text when an older projection arrives.
- Persona and translator draft fields keep newer local edits through delayed
  projection.
- Lorebook/script/trigger/module/plugin draft collections merge by id/key
  instead of wholesale reseeding dirty rows.

## Exit Criteria

- Dirty projection helper coverage proves clean-field refresh and dirty-field
  preservation.
- Character editor P0 rows have focused tests for scalar, nested object, and
  array/list fields.
- Prompt item and script/trigger collection tests cover edit-after-dispatch then
  older projection.
- Remaining unconverted projection paths are listed in `../status.md` with a
  reason and owner phase.

## Validation

```bash
pnpm exec vitest run src/ts/characterCommands.test.ts
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add focused component/store tests for the draft helpers touched by this phase.

## Risks

- Dirty maps can leak if they are not cleared on target change or component
  teardown.
- Treating a successful projection as proof of the latest local value is unsafe
  unless it matches the attempted value for the same target.
