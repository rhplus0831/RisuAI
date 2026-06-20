# Phase 3: Settings Model Shell

Status: completed.

Goal: replace the normal Settings -> Model workflow with profile-first Roles and
Profiles tabs while keeping legacy compatibility available but deemphasized.

## Scope

- Decide whether to extract a dedicated `ModelSettings.svelte` from
  `BotSettings.svelte`.
- Implement Settings -> Model tabs:
  - Roles
  - Profiles
- Roles tab:
  - use canonical `MODEL_ROLES` order
  - show binding mode, inherited source, effective profile, provider/model,
    status, and fallback count
  - edit bindings with Apply/Cancel
- Profiles tab:
  - show Runtime Defaults section placeholder or summary
  - list profiles with name, provider, model/request model, status, used-by roles
  - actions for create, edit, duplicate, delete
- Add legacy conversion prompt when opening Settings -> Model for clearly
  legacy-only data.
- Declining the prompt is browser-local or memory-local only.
- Show Convert to Profiles action after declined prompt.
- Put old legacy/global controls behind Advanced Legacy Settings for
  declined-legacy states.
- Hide old global provider panels from the profile-first normal workflow.
- Add language strings.

## Out Of Scope

- Full profile provider editor panels.
- Runtime defaults field editor.
- Fallback editor.
- Generation guardrails.

## Anchors

- `src/lib/Setting/Settings.svelte`
- `src/lib/Setting/Pages/BotSettings.svelte`
- `src/lib/Setting/Pages/Model/ModelRoleList.svelte`
- `src/lib/Setting/Pages/Model/ModelRoleEditor.svelte`
- `src/lib/Setting/Pages/Model/`
- `src/ts/model/modelProfileUiState.ts`
- `src/ts/setting/botSettingsParamsData.ts`
- `src/lang/en.ts`
- `src/lang/index.test.ts`

## Exit Criteria

- Settings -> Model no longer presents the old Model/Parameters submenu as the
  normal profile-first workflow.
- Legacy provider panels do not appear merely because a profile uses a provider.
- Legacy-only data gets a contextual conversion prompt.
- Role and profile list shells render without editing legacy flat fields.
- Focused Svelte/source tests pass.

## Validation

```bash
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lang/index.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

Use `pnpm dev:agent` for browser smoke when the shell is interactive.

## Risks

- Prompt settings still reuse `BotSettings settingsKind="prompt"`; extraction
  must not break prompt parameter override behavior.
- Existing setting components autosave. The profile shell should use explicit
  drafts for role binding changes.
