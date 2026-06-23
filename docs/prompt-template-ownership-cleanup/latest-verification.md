# Latest Verification

Date: 2026-06-23

Phase 3 Settings UI ownership has focused automated coverage plus a browser
smoke. Prompt Settings and Bot Settings now treat the selected prompt preset as
the visible prompt-template owner while preserving top-level `promptTemplate` as
a compatibility projection.

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

## Phase 3 Validation

Run on 2026-06-23:

```bash
pnpm exec vitest run src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lib/Setting/Settings.svelte.test.ts src/lib/Setting/pickerGenerationSettings.test.ts --reporter=dot
pnpm exec vitest run src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/promptTemplateHydration.test.ts src/ts/storage/database.svelte.test.ts --reporter=dot
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

All commands passed.

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

- No new browser smoke was run for the preset-switch hydration fix; the latest
  recorded browser smoke remains the Phase 3 Settings page smoke above.
