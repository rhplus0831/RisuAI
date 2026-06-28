# Phase 3: Settings UI And Bridge

Status: implemented.

Goal: make the visible prompt-template editor and related settings controls edit
the selected modern prompt preset directly.

## Scope

- Update `PromptSettings.svelte` draft source from top-level
  `DBState.db.promptTemplate` to selected `promptPresets[promptPresetsId]`.
- Update selection signatures and reconciliation to track prompt preset id,
  prompt preset body revision, and hydration state.
- Replace `mirrorTopLevelPresetField('promptTemplate', ...)` calls with direct
  prompt preset mutation or owner-aware bridge calls.
- Update `BotSettings.svelte` prompt-template toggle to create/clear template
  state on the selected prompt preset, not top-level `DBState.db.promptTemplate`.
- Keep language strings and UX clear around selected prompt preset ownership.
- Preserve compatibility UI for legacy bot presets without letting it become
  the normal editor target.

## Out Of Scope

- Prompt card component redesign.
- Legacy bot preset extraction UI beyond what is required for safe
  compatibility display.
- Removing top-level compatibility state.

## Anchors

- `src/lib/Setting/Pages/PromptSettings.svelte`
- `src/lib/Setting/Pages/BotSettings.svelte`
- `src/lib/Setting/botpreset.svelte`
- `src/ts/presetFieldMirror.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/server/promptTemplateBridge.svelte.ts`
- `src/lang/*`

## Exit Criteria

- Opening Prompt Settings hydrates and edits the selected prompt preset template.
- Switching prompt presets resets the prompt-template draft from the newly
  selected owner.
- Prompt-template enable/disable controls operate on prompt presets.
- Legacy bot preset selection no longer surprises the editor by changing the
  durable prompt template owner.
- UI tests cover selected-prompt-preset ownership.

## Implementation Notes

- `PromptSettings.svelte` now clones the selected
  `promptPresets[promptPresetsId].promptTemplate` first for initialization,
  reset, mount, and revision reconciliation. Top-level `DBState.db.promptTemplate`
  is used only when no modern selected prompt preset exists.
- Explicit whole-template edits sync the selected prompt preset projection and
  the top-level compatibility projection locally. Per-row edits still dispatch
  owner-scoped prompt-item commands with `promptPresetId`; they do not go
  through whole prompt-preset update commands.
- `BotSettings.svelte` prompt-template visibility and enable/disable controls
  now check selected prompt preset ownership. Enabling creates
  `promptPresets[selected].promptTemplate = []` and dispatches scoped
  `enablePromptItemsCommand`; disabling removes that selected preset field and
  clears top-level compatibility projection.

## Validation

```bash
pnpm exec vitest run src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lib/Setting/Settings.svelte.test.ts src/lib/Setting/pickerGenerationSettings.test.ts
pnpm exec vitest run src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/promptTemplateHydration.test.ts src/ts/storage/database.svelte.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
git diff --check
```

Run on 2026-06-23: all commands above passed.

Browser smoke run on 2026-06-23 with `pnpm dev:agent`:

```bash
pnpm dev:agent
```

Smoke target `http://localhost:6418/settings` loaded in Chromium without page
errors. The initial `networkidle` wait timed out because the app keeps an event
stream open; retrying with `domcontentloaded` passed. The dev server was stopped
after smoke and ports `6418`/`6419` were clear.

## Risks

- Svelte effects can rehydrate drafts on every projection update if revision
  gates are not preserved.
- Prompt Settings may accidentally edit a stubbed prompt preset body before
  hydration completes.
- Existing tests may assume `DBState.db.promptTemplate` exists after hydration.
