# Phase 4: Profile Editor Providers

Status: not started.

Goal: implement the full profile editor for first-class providers, runtime
defaults, and fallbacks.

## Scope

- Implement profile editor drawer/modal with Save/Cancel and unsaved-change
  warning.
- Implement profile create/update/duplicate/delete UI around Phase 2 commands.
- Show used-by roles near editor actions.
- Implement provider-first panels for:
  - OpenAI
  - Anthropic
  - Google Gemini API
  - Vertex AI
  - Custom API
- Official provider panels:
  - model picker
  - advanced manual model id
  - advanced request model override
  - profile-local API key where applicable
  - no custom base URL/endpoint overrides
- Vertex panel:
  - model
  - project ID
  - region
  - client email
  - private key secret behavior
- Custom API panel:
  - base URL
  - request model
  - optional API key
  - structured extra headers
  - structured additional params
  - advanced tokenizer/capability overrides
  - warning if base URL includes `/chat/completions`
- Runtime Defaults editor with Save/Cancel.
- Runtime override UI for profile-local `runtimeOptions`.
- Fallback editor:
  - default Add fallback profile
  - advanced raw model fallback
  - existing raw fallbacks editable
- Compatibility-placeholder profiles:
  - rename
  - duplicate
  - delete/reassign
  - resolved summary and compatibility notice
  - no partial provider-specific editing

## Out Of Scope

- Dynamic model catalog fetching for providers outside first-class scope.
- Custom Models catalog editing.
- Test Profile action.
- Import/export UI.

## Anchors

- `src/lib/Setting/Pages/Model/`
- `src/lib/UI/ModelList.svelte`
- `src/ts/model/modellist.ts`
- `src/ts/model/providers/`
- `src/ts/server/commands.ts`
- `src/ts/setting/botSettingsParamsData.ts`
- `src/lib/Others/AllSeperateParameters.svelte`
- `src/lang/en.ts`

## Exit Criteria

- Users can create, edit, duplicate, and delete first-class profiles.
- Users can edit runtime defaults and profile runtime overrides explicitly.
- Users can edit fallback profile refs and raw model fallback refs.
- Secret fields follow preserve/replace/empty-clears behavior.
- Compatibility profiles remain manageable without pretending to be
  first-class editable providers.
- Focused component/source tests pass.

## Validation

```bash
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lang/index.test.ts
pnpm exec vitest run src/ts/server/commands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

Use `pnpm dev:agent` for browser smoke on desktop and mobile widths after the
editor is wired.

## Risks

- `ModelList` opens a modal; nesting inside a drawer needs z-index/mobile
  testing.
- Reusing data-driven settings renderers can accidentally autosave profile
  drafts. Prefer isolated editor drafts unless the renderer gains draft context.
- Secret field UX must distinguish untouched masked values from empty-clears.

