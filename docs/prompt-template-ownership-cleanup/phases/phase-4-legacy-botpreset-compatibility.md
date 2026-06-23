# Phase 4: Legacy BotPreset Compatibility

Status: pending.

Goal: retire silent legacy bot-preset prompt-template copy semantics while
preserving compatibility with old saves and exports.

## Scope

- Remove or gate `promptTemplate` from legacy `applyPreset()` behavior.
- Stop legacy preset select/delete apply paths from writing `prompt_templates`
  as the durable template side effect.
- Stop client `setPreset()` from assigning `db.promptTemplate =
  newPres.promptTemplate` for normal operation.
- Stop `saveCurrentPresetLocal()` from snapshotting top-level
  `db.promptTemplate` back into legacy bot presets as the normal save path.
- Add an explicit extraction/conversion path from legacy bot preset prompt data
  to modern prompt presets.
- Preserve imported/exported legacy fields where compatibility requires it.
- Update tests that currently expect `bot_presets + prompt_templates +
  settings` writes on legacy preset selection.

## Out Of Scope

- Removing the legacy bot preset list UI entirely.
- Removing legacy bot preset import/export support.
- Changing model/runtime behavior of legacy bot presets unless required to
  isolate prompt-template ownership.

## Anchors

- `server/fastify/src/commands/presets.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/loadout.ts`
- `src/lib/Setting/botpreset.svelte`
- `src/lib/Others/PromptDiffModal.svelte`
- `server/fastify/src/risuSave/importSnapshot.ts`
- `server/fastify/src/risuSave/exportSnapshot.ts`

## Exit Criteria

- Selecting a legacy bot preset no longer silently changes the modern prompt
  template owner.
- Legacy prompt-template data can be intentionally extracted into a prompt
  preset.
- Legacy exports/imports preserve expected compatibility data.
- Server and client tests document the new behavior.

## Validation

```bash
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/loadout.test.ts src/ts/presetSplit.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/risuSaveCodec.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

## Risks

- Some legacy workflows may have relied on bot preset selection changing the
  prompt template. Provide an explicit extraction/apply path to replace the
  hidden side effect.
- Removing snapshot behavior too early can cause compatibility exports to omit
  expected legacy fields.
- Prompt diff/export tooling may still read legacy bot preset prompt templates.
