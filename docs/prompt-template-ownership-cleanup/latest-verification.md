# Latest Verification

Date: 2026-06-23

Phase 5 generation/loadout cleanup has focused automated coverage. Browser
local/parity generation now hydrates the same prompt-preset owner used by
template normalization, and generic top-level preset-field mirroring no longer
copies `promptTemplate` into the selected prompt preset.

Follow-up fix: verifier review found that owner-scoped generation hydration was
still discarded by `promptTemplateHydration` when the chat prompt preset differed
from the selected/global prompt preset. Hydration now writes the requested
owner's `promptPresets[].promptTemplate` row for generation/local assembly while
leaving the visible top-level compatibility projection on the current selected
owner.

## Current Proof

- Source exploration completed.
- Plan folder created under `docs/prompt-template-ownership-cleanup`.
- Runtime prompt template reads resolve through the effective prompt-preset
  owner before top-level fallback.
- Prompt item command wrappers and Fastify handlers accept optional
  `promptPresetId`.
- Scoped prompt item create/update/delete/reorder/enable validates the selected
  prompt preset owner and persists the owning `prompt_presets` row instead of
  durable `prompt_templates`.
- Prompt item create/delete/reorder and enable capture the selected owner at the
  optimistic edit point, drop stale command construction after owner changes,
  and skip stale rollback when another owner is now visible.
- `promptItem` projection/hydration derives selected/requested
  `promptPresets[].promptTemplate` and clears stale compatibility
  `promptTemplate` when the selected owner has no template.
- Bridge pending prompt item updates are keyed by owner plus item id and stale
  selected-owner debounced edits are dropped before send.
- Focused browser/server precedence tests landed for prompt preset ownership,
  chat-scoped override, no-template disabling, legacy bot preset non-ownership,
  and no mutation during normalization.
- Server author-note defaults now use the chat-scoped prompt preset ID before
  considering global or top-level templates.
- Prompt Settings draft initialization, reset, mount, and reconciliation now
  adopt the selected prompt preset template before any top-level compatibility
  projection.
- Prompt Settings switches selected prompt presets without adopting stale
  top-level `DBState.db.promptTemplate`.
- Prompt Settings triggers owner-scoped hydration on selected prompt preset
  changes even when the new owner is not hydrated yet, then adopts the hydrated
  selected-preset template only if that owner is still current.
- Prompt Settings keeps row edits on owner-scoped prompt-item commands with
  `promptPresetId`; whole-template local optimistic updates sync selected prompt
  preset ownership and compatibility projection.
- Bot Settings gates template editor visibility on selected prompt preset
  ownership, so stale top-level compatibility data does not show the editor for
  a selected preset that lacks `promptTemplate`.
- Bot Settings also kicks owner-scoped prompt-template hydration when selected
  prompt presets change, preventing the prompt template gate from staying
  stuck on a stale owner.
- Bot Settings enable/disable creates/removes selected prompt preset
  `promptTemplate` ownership and dispatches scoped `enablePromptItemsCommand`.
- Server legacy bot-preset apply/snapshot keys exclude `promptTemplate`.
- Legacy preset select/delete apply routes no longer write `prompt_templates`
  and use legacy-only collection reads when prompt-template data is not needed.
- Browser `setPreset()` no longer assigns `DBState.db.promptTemplate` from a
  legacy bot preset.
- Browser `saveCurrentPresetLocal()` and loadout legacy preset snapshots no
  longer copy top-level `promptTemplate` into `botPresets[]`.
- Legacy bot-preset hydration no longer depends on `promptTemplate` as the sole
  loaded-data sentinel.
- Explicit legacy extraction still creates modern prompt presets with copied
  `promptTemplate` data.
- Browser local/parity prompt assembly hydrates/checks chat-scoped
  `generationSettings.promptPresetId` before the selected/global prompt-preset
  owner, and non-current chat-owner hydration is retained for local assembly
  without overwriting the selected/global top-level compatibility projection.
- Generic `mirrorTopLevelPresetField()` skips `promptTemplate`, while other
  prompt preset fields still mirror through the existing compatibility path.
- Bootstrap lazy prompt-item projection expectations now match the current
  contract: a selected modern prompt preset without `promptTemplate` returns
  `null` instead of falling back to stale top-level compatibility data.
- Server prompt-preset select/update/delete writes to `prompt_templates` remain
  quarantined as a compatibility mirror for this phase.

## Phase 5 Validation

Run on 2026-06-23:

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChatPromptAssembly.lazyPromptTemplate.test.ts src/ts/process/__tests__/normalizeTemplate.test.ts src/ts/process/request/tests/serverPromptAssembly.test.ts src/ts/loadout.test.ts src/ts/presetFieldMirror.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/templates.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/projection.test.ts server/fastify/__tests__/commandCollectionRange.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm exec prettier --write src/ts/process/sendChatPromptAssembly.ts src/ts/process/__tests__/sendChatPromptAssembly.lazyPromptTemplate.test.ts src/ts/presetFieldMirror.ts src/ts/presetFieldMirror.test.ts server/fastify/__tests__/bootstrap.test.ts docs/prompt-template-ownership-cleanup/SOLVE-NOTE.md docs/prompt-template-ownership-cleanup/status.md docs/prompt-template-ownership-cleanup/phases/phase-5-generation-loadout-and-cleanup.md
pnpm exec prettier --write docs/prompt-template-ownership-cleanup/latest-verification.md
git diff --check
```

All commands passed. The first server validation run exposed a stale bootstrap
test expectation for prompt-item lazy projection; the expectation was updated
to the selected prompt-preset ownership contract and the suite passed on rerun.

Additional Phase 5 fix validation run on 2026-06-23:

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChatPromptAssembly.lazyPromptTemplate.test.ts src/ts/server/promptTemplateHydration.test.ts src/ts/presetFieldMirror.test.ts
pnpm exec vitest run src/ts/process/__tests__/normalizeTemplate.test.ts src/ts/process/request/tests/serverPromptAssembly.test.ts src/ts/loadout.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

All commands passed. The new regression covers a chat-scoped prompt preset that
differs from the selected/global owner: hydration succeeds, local assembly
continues, the chat owner row is populated, and the visible top-level/global
projection is not overwritten.

## Phase 4 Validation

Run on 2026-06-23:

```bash
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/loadout.test.ts src/ts/presetSplit.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm exec prettier --check server/fastify/src/commands/presets.ts server/fastify/src/routes/commands.ts src/ts/storage/database.svelte.ts src/ts/loadout.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts src/ts/storage/database.svelte.test.ts src/ts/loadout.test.ts
git diff --check
```

All commands passed.

Additional run:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts server/fastify/__tests__/commandCollectionRange.test.ts
```

This passed after updating the decoded loadout fixture expectation for
normalized split-preset fields.

## Browser Smoke

Run on 2026-06-23:

- Started `pnpm dev:agent`.
- Loaded `http://localhost:6418/settings` in Chromium with `domcontentloaded`
  wait and a Settings/Prompt/Model text sanity check.
- No page errors or console errors were captured.
- Stopped the dev server and confirmed no listeners remained on ports `6418`
  or `6419`.

Note: a first smoke attempt using Playwright `networkidle` timed out because
the app keeps the events request open; this was not treated as an application
failure.

## Verification Gaps

- No new browser smoke was run for Phase 5 because the slice did not change UI
  components.
