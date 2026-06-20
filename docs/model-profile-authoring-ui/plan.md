# Model Profile Authoring UI

Date: 2026-06-20

## Goal

Build the full visible Durable Profile editor and profile-first Settings ->
Model experience. This is the direct follow-up to the closed model config
profiles workstream: the runtime machinery exists, but the UI still mostly edits
legacy flat compatibility fields.

End state:

- New/default state creates generated Main Chat and Auxiliary profiles with
  opaque `mp_` ids and binds those roles to the generated profile ids.
- Other roles inherit by default from their source roles.
- Settings -> Model exposes Roles and Profiles tabs.
- Roles tab edits `modelRoleProfiles` with explicit Apply/Cancel and compact
  resolved summaries.
- Profiles tab edits `modelProfiles` and `modelRuntimeDefaults` with explicit
  Save/Cancel.
- Profiles are provider-first through a top-level `providerId`.
- First-class provider panels cover only `openai`, `anthropic`, `google`,
  `vertex`, and `custom-api`.
- Profile-bound generation is self-contained and does not silently borrow
  legacy/global provider fields.
- Legacy flat fields remain as compatibility data and conversion inputs.

## Locked Design Contract

The locked design decisions live in
[`../model-profile-ui-ux-decisions.md`](../model-profile-ui-ux-decisions.md).
This plan treats that file as source of truth for UI/UX choices.

Important contract points:

- `ModelProfileRecord.id` remains the machine identity, but new ids are opaque
  hash-like values. Human labels use `name`.
- Add top-level `providerId` for first-class provider/category selection.
- Add explicit `modelRuntimeDefaults` storage using the same runtime option
  schema as profile `runtimeOptions`.
- Profile runtime precedence is hard defaults -> `modelRuntimeDefaults` ->
  profile `runtimeOptions`.
- Explicit broken profile bindings are errors, not permission to fall back to
  legacy settings.
- Compatibility profiles omit `providerId`; compatibility is a status, not a
  fake provider.
- Custom API is OpenAI-compatible Chat Completions only in this pass.
- Custom API uses a base URL field; the app appends `/chat/completions`.
- Vertex private keys are profile-local secret-like fields.
- Raw model fallbacks use `{ mode: 'model', modelId }` and keep static-model
  compatibility behavior.

## Current Problem Shape

The codebase has durable profile records, but the visible model settings surface
still edits legacy fields:

- `ModelRoleList.svelte` writes `aiModel`, `subModel`, `modelRoles`,
  `seperateModels`, `fallbackModels`, and separate parameter fields.
- `BotSettings.svelte` shows model roles and then global provider panels based
  on `modelProfileUiState` scanning.
- `modelProfiles` rows do not yet have `providerId`, raw model fallbacks,
  provider-first Custom API/Vertex shapes, or runtime defaults.
- `resolveModelProfile()` falls back to legacy when a durable binding is missing
  or points to a profile without `modelId`.
- Profile-bound provider options still borrow many legacy globals.
- Whole-array settings patches exist, but row-oriented atomic profile commands
  do not.

## Target Data Contract

### Profile Record

The durable profile record remains array-backed and stable-id keyed:

- `id`: opaque `mp_` style stable id.
- `name`: human-readable label.
- `providerId?`: first-class provider/category when known.
- `modelId?`: selected model id or sentinel `custom-api`.
- `providerOptions?`: request-affecting provider fields.
- `runtimeOptions?`: profile-local runtime overrides.
- `fallbacks?`: fallback profile refs or raw model fallback refs.

Provider options should grow to support:

- `apiKey`
- `requestModel`
- `extraHeaders`
- `additionalParams`
- `vertex.projectId`
- `vertex.region`
- `vertex.clientEmail`
- `vertex.privateKey`
- `customApi.tokenizer`
- `customApi.flags`
- Custom API base URL, using the existing `baseUrl` field unless the
  implementation finds a clearer compatible name.

### Runtime Defaults

Add:

- `Database.modelRuntimeDefaults`

Use the same schema as `ModelProfileRecordRuntimeOptions`. New UI writes this
field, not legacy flat parameter fields. Legacy flat and separate parameters
remain conversion and legacy-mode fallback data.

### Role Bindings

`modelRoleProfiles` remains the role binding map:

- `profile`: bind to a profile id.
- `inherit`: use the source role's resolved profile.
- `legacy`: compatibility mode.

Low-level normalization remains conservative. A higher-level new/default
initializer creates generated profiles and bindings atomically.

## Command Contract

Generic settings patches remain compatible, but profile-first UI should use
row-oriented commands:

- create profile
- update profile
- duplicate profile
- delete profile with reassignment
- update role bindings
- create profile and bind role
- convert legacy settings to profiles
- update runtime defaults

Multi-key operations must be one revision:

- conversion writes `modelProfiles`, `modelRoleProfiles`, and
  `modelRuntimeDefaults`
- create-and-bind writes profile and role binding together
- delete-reassign removes profile and updates affected role bindings together

## UI Contract

Settings -> Model should be purpose-built for profiles:

- Roles tab:
  - canonical `MODEL_ROLES` order
  - role name, binding mode, effective profile, provider/model, status, fallback
    count
  - inherited source display
  - Apply/Cancel for binding changes
- Profiles tab:
  - Runtime Defaults section
  - profile list with name, provider, model/request model, status, used-by roles
  - create/edit/duplicate/delete actions
  - editor drawer/modal with Save/Cancel
- Legacy compatibility:
  - prompt conversion when opening Settings -> Model for clearly legacy-only
    data
  - declined prompt is browser-local or memory-local only
  - keep Convert to Profiles visible
  - put old controls behind Advanced Legacy Settings

## First-Class Provider Scope

Support only these provider panels in this implementation:

- `openai`: official OpenAI API/models only.
- `anthropic`: Anthropic API/models.
- `google`: Gemini API key flow.
- `vertex`: Vertex AI auth/config flow.
- `custom-api`: OpenAI-compatible Chat Completions only.

Everything else remains compatibility-only until intentionally added with field
mapping, validation, resolver behavior, UI, and tests.

## Non-Goals

- Profile import/export UI.
- Broad import/export migration tooling.
- Profile-to-profile inheritance.
- Shared credential store.
- Custom Models catalog editing.
- Test Profile action.
- Search/filter, tags/favorites, manual reordering, icons/colors.
- Raw resolved request/debug JSON UI.
- Moving memory embeddings into chat profiles.

## Remaining Open Questions

- Exact legacy-to-profile conversion algorithm for every legacy role and
  separate-parameter edge case.
- Exact command endpoint/request/response shapes.
- Whether `mp_` ids are client-minted with server collision checks or
  server-minted by centralized helpers.
- Prompt assembly threading required to avoid stale `db.aiModel` assumptions.
- Whether Custom API headers can ever be secret-bearing and need masking.
- Exact component split after deciding whether to extract a dedicated
  `ModelSettings.svelte`.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Broken explicit profile bindings currently fall back to legacy | Profile-first UI can hide real misconfiguration | Invert resolver behavior with tests before UI depends on it |
| Provider-first profiles still pass through legacy `db.aiModel` prompt assembly assumptions | Prompt/tokenizer behavior can mismatch selected profile | Audit prompt assembly and thread resolved profile/model info where needed |
| Generic settings patch loses updates for profile rows | Profile edits can overwrite concurrent changes | Use row-oriented atomic commands for UI |
| Custom API optional auth conflicts with current OpenAI adapter | Local unauthenticated endpoints cannot work | Add narrow optional-auth path for `custom-api`, not official OpenAI |
| Secret masking only covers profile `apiKey` | Vertex private key can leak or be overwritten | Extend masking paths and row-identity tests |
| Existing autosave setting components do not match explicit Save/Cancel | Profile editor can persist partial edits unexpectedly | Use isolated drafts and avoid `SettingRenderer` unless it supports draft context |
| Old global provider panels leak into profile-first UI | Users edit fields that active profiles ignore | Gate legacy panels behind compatibility section |

