# Phase 2: Dirty Draft Projection

Status: complete as of 2026-06-17.

Goal: prevent server projection, hydration, and successful command reconciliation
from reseeding local drafts that changed after the request began.

## Scope

- Add dirty-field tracking and projection merge behavior for character profile
  drafts.
- Apply the same pattern to prompt-template item rows, server-backed setting and
  global regex drafts, selected persona profile drafts, translator preset
  fields, lorebook entry drafts, and selected-character script/trigger live local
  draft rows.
- Clear dirty fields only when the matching command succeeds for the same
  target and attempted value, or when the user intentionally discards/reloads.
- Ensure successful projection for one field can still refresh clean sibling
  fields.

Phase 2 is closed around dirty projection protection for existing draft surfaces.
Collection creation/deletion/reordering/import/selection behavior, callbacks,
chat/message/generation freshness, resync/import/restore/navigation/memory
fences, and broad module/plugin collection/storage/provider/argument behavior
are explicitly owned by later phases.

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

- Character profile draft fields are protected from the
  `CharacterProjectionDirtyGap` found across the character editor audit.
- Prompt item field edits do not lose newer unsent text when an older projection
  arrives for the same item sequence.
- Persona and translator draft fields keep newer local edits through delayed
  projection.
- Lorebook and selected-character script/trigger draft rows merge by id/key
  instead of wholesale reseeding dirty rows when the projected row sequence is
  still compatible.

## Landed Slices

- Character profile draft dirty top-level projection protection.
- Prompt-template item row dirty projection merge.
- Generic `createServerBackedSettingDraft` whole-key dirty projection
  protection.
- Selected persona profile dirty projection protection.
- Translator preset `name`/`prompt`/`maxResponse` dirty projection protection.
- Lorebook entry draft dirty projection merge.
- Selected-character script/trigger live local draft dirty projection merge.

## Exit Criteria

- Dirty projection helper coverage proves clean-field refresh and dirty-field
  preservation.
- Focused draft/store tests cover the landed Phase 2 slices listed above.
- Remaining unconverted paths are listed in `../status.md` with explicit owner
  phases.
- Closeout explorer returned PASS/CLOSEABLE for Phase 2 with the deferrals below.

## Residuals By Owner Phase

- Phase 3: upload/import/fetch callbacks, including module/plugin
  import/update/fetch/upload callbacks.
- Phase 4: chat/message/generation freshness.
- Phase 5: create/delete/reorder/import/select and broad collection rollback.
- Phase 5: module/plugin broad rollback, collection, storage, provider, and
  argument behavior. Submit-only module drafts do not block Phase 2.
- Phase 6: resync/import/restore/navigation/memory fences.
- Outside Phase 2: projection-absent optional clean-field deletion. The shared
  merge helper refreshes fields present in the projection surface and does not
  treat absent optional projection fields as deletion instructions in this phase.

## Validation

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/persona.test.ts src/lib/Setting/Pages/PersonaSettings.svelte.test.ts src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Closeout validation is recorded in `../latest-verification.md`.

## Risks

- Dirty maps can leak if future slices do not clear them on target change or
  component teardown.
- Treating a successful projection as proof of the latest local value remains
  unsafe unless it matches the attempted value for the same target.
