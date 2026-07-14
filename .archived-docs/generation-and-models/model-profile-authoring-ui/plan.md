# Model Profile Authoring UI

Date: 2026-06-20

## Goal

Build the full visible Durable Profile editor and profile-first Settings ->
Model experience. This was the direct follow-up to the closed model config
profiles workstream: the runtime machinery existed, but the UI still mostly
edited legacy flat compatibility fields.

Status: achieved in phases 0-6.

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
[`decisions.md`](decisions.md).
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

## Historical Starting Problem Shape

At the start of this workstream, the codebase had durable profile records, but
the visible model settings surface still edited legacy fields:

- `ModelRoleList.svelte` wrote `aiModel`, `subModel`, `modelRoles`,
  `seperateModels`, `fallbackModels`, and separate parameter fields.
- `BotSettings.svelte` showed model roles and then global provider panels based
  on `modelProfileUiState` scanning.
- `modelProfiles` rows did not yet have `providerId`, raw model fallbacks,
  provider-first Custom API/Vertex shapes, or runtime defaults.
- `resolveModelProfile()` fell back to legacy when a durable binding was missing
  or points to a profile without `modelId`.
- Profile-bound provider options borrowed many legacy globals.
- Whole-array settings patches existed, but row-oriented atomic profile commands
  did not.

## Implemented Data Contract

### Profile Record

The durable profile record remains array-backed and stable-id keyed:

- `id`: opaque `mp_` style stable id.
- `name`: human-readable label.
- `providerId?`: first-class provider/category when known.
- `modelId?`: selected model id or sentinel `custom-api`.
- `providerOptions?`: request-affecting provider fields.
- `runtimeOptions?`: profile-local runtime overrides.
- `fallbacks?`: fallback profile refs or raw model fallback refs.

Provider options now support:

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
- Custom API base URL in the existing `baseUrl` field.

### Runtime Defaults

`Database.modelRuntimeDefaults` stores runtime defaults.

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

Generic settings patches remain compatible, but profile-first UI uses
row-oriented commands:

- create profile
- update profile
- duplicate profile
- delete profile with reassignment
- update role bindings
- create profile and bind role
- convert legacy settings to profiles
- update runtime defaults

Multi-key operations are one revision:

- conversion writes `modelProfiles`, `modelRoleProfiles`, and
  `modelRuntimeDefaults`
- create-and-bind writes profile and role binding together
- delete-reassign removes profile and updates affected role bindings together

## UI Contract

Settings -> Model is purpose-built for profiles:

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

## Closed Questions And Outcomes

- Legacy-to-profile conversion is command-backed and writes `modelProfiles`,
  `modelRoleProfiles`, and `modelRuntimeDefaults` together.
- Profile row, role binding, runtime defaults, duplicate, delete/reassign,
  create-and-bind, and conversion commands are implemented with targeted
  `modelProfile` projection refresh.
- New profile ids use opaque `mp_` ids generated through the command helpers.
- Prompt assembly and server chat dispatch resolve profile-bound model/runtime
  config before budgeting and provider dispatch instead of assuming
  `db.aiModel`.
- Custom API extra headers remain plain profile provider options in this pass;
  profile-local `apiKey` and Vertex private key handling use secret placeholder
  behavior.
- The component split is `ModelSettingsShell`, `ModelProfileRoleList`,
  `ModelProfileList`, `ModelProfileEditorDrawer`, `ModelRuntimeDefaultsEditor`,
  provider/runtime/fallback subeditors, and legacy `ModelRoleList` behind
  Advanced Legacy Settings.

Canonical compatibility caveats:

- Legacy flat fields remain: `aiModel`, `subModel`, `modelRoles`,
  `seperateModels`, `fallbackModels`, separate parameters, and provider globals.
- Compatibility profiles omit `providerId`; they may generate when routable but
  are not first-class provider panels.
- Unsupported `providerId` values are placeholders, shown unsupported and
  blocked for active durable generation.
- Memory summaries use memory-role profiles; memory embeddings remain separate
  Hypa/Voyage/custom embedding config.
- Custom Models catalog (`customModels` / `xcustom:::`) remains separate from
  first-class Custom API profiles.

## Historical Risk Register

These were the risks tracked while the workstream was active; the listed
mitigations were implemented or preserved as compatibility boundaries.

| Risk | Impact | Implemented mitigation |
| --- | --- | --- |
| Broken explicit profile bindings fell back to legacy | Profile-first UI could hide real misconfiguration | Resolver now reports incomplete status for explicit broken durable bindings, with tests. |
| Provider-first profiles passed through legacy `db.aiModel` prompt assembly assumptions | Prompt/tokenizer behavior could mismatch selected profile | Prompt assembly and server chat dispatch now thread resolved profile model/runtime config. |
| Generic settings patches could lose updates for profile rows | Profile edits could overwrite concurrent changes | Row-oriented atomic commands drive the profile-first UI. |
| Custom API optional auth conflicted with the existing OpenAI adapter | Local unauthenticated endpoints could not work | Custom API has a narrow optional-auth path separate from official OpenAI. |
| Secret masking originally covered only profile `apiKey` | Vertex private key could leak or be overwritten | Masking paths and row-identity tests cover profile-local secrets. |
| Existing autosave setting components did not match explicit Save/Cancel | Profile editor could persist partial edits unexpectedly | The editor uses isolated drafts and explicit Save/Cancel instead of `SettingRenderer` autosave. |
| Old global provider panels could leak into profile-first UI | Users could edit fields that active profiles ignore | Global provider panels are behind Advanced Legacy Settings compatibility UI. |
