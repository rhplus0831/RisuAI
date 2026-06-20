# Model Profile UI/UX Decisions

Status: working decision log.

This note captures the locked decisions from the Durable Profile UI discussion.
It is not yet the implementation plan. Use it as the shared baseline before
clarifying the remaining technical ambiguities and drafting the work plan.

Source context:

- `.archived-docs/model-config-profiles/` completed the resolver, persistence,
  dispatch, validation, compatibility, and summary UI work.
- Durable profile authoring UI was intentionally deferred there.
- This follow-up targets the deferred visible Durable Profile UI/UX.

## Product Direction

- Build the full Durable Profile editor directly rather than shipping an
  intentionally minimal intermediate editor.
- Keep legacy flat DB fields for compatibility, imports, presets, copied data,
  and fallback paths.
- Do not keep the legacy/global provider UI as the normal visible model
  configuration workflow once profile editing covers those fields.
- For profile-backed data, the primary UI should be profile/inherit based.
- For legacy-state data, deemphasize legacy controls and recommend conversion
  to Durable Profiles.
- When profile-first state is active, hide old legacy/global provider panels
  from the normal Settings -> Model workflow.
- In profile-first UI, provider-specific controls should be shown by the active
  profile editor context, not by global provider visibility scanning.
- Existing profile UI state can still inform summaries/status, but should not
  cause old global provider panels to appear for profile-bound providers.
- Legacy provider visibility behavior can remain inside the Advanced Legacy
  Settings compatibility section.
- If legacy-only data remains after the user declines conversion, show a compact
  compatibility panel with Convert to Profiles as the prominent action.
- In declined legacy-only states, put old controls behind an Advanced Legacy
  Settings accordion/section rather than presenting them as the main workflow.

## Defaults And Conversion

- New/default state should start profile-first.
- Generate Durable Profiles for Main Chat and Auxiliary by default.
- Bind Main Chat to the generated Main Chat profile.
- Bind Auxiliary to the generated Auxiliary profile.
- Use the existing profile `id` field as an opaque/hash-like stable UID, not as
  a human-readable semantic slug.
- Use profile `name` as the human-readable label.
- Profile IDs must not be derived from editable profile content such as name,
  selected model, provider settings, or runtime settings.
- Generated profile IDs should use an opaque prefix such as `mp_` plus
  random/hash-safe entropy.
- Profile creation, conversion, and default generation must check existing
  `modelProfiles` and regenerate if an ID collision occurs.
- Existing profile IDs must never change after creation.
- Default Main Chat and Auxiliary profiles do not need deterministic IDs; their
  role bindings can point to the generated IDs created in the same operation.
- Keep low-level normalization/default helpers conservative so missing or
  malformed profile role bindings can still normalize to legacy-safe values.
- Add a higher-level new-database/default initializer that creates generated
  profiles and role bindings together.
- Do not make low-level default bindings point to generated IDs when the
  generated profile records may not exist.
- Other roles should inherit by default from their current source role.
- The app should still support a no-Durable-Profile state internally for
  compatibility and legacy data.
- Legacy conversion should be prompted first.
- The legacy conversion prompt should appear when opening Settings -> Model for
  legacy-only data.
- Do not show the conversion prompt as a startup modal.
- Do not block generation solely because data has not been converted from
  legacy mode yet.
- If the user declines conversion, keep the legacy state usable and keep a
  visible Convert to Profiles action available later.
- Remembering a declined conversion prompt should be browser-local or
  memory-local UI state only.
- Do not persist the declined conversion prompt state to server/model settings.
- Prompt conversion only for clearly legacy-only data:
  - no profiles exist, or no role is bound to a valid profile
  - role bindings are missing, all legacy, or invalid-profile fallbacks
  - enough legacy model config exists to convert, such as Main Chat or Auxiliary
    model settings
- Do not prompt conversion for already profile-bound Main/Aux states, mixed
  compatibility states, or malformed partial states that cannot be converted
  safely.
- Conversion should always create Main Chat and Auxiliary profiles.
- Conversion should create additional role profiles only where existing legacy
  role behavior differs and would otherwise be lost.
- During conversion, global/base generation parameters should move into
  `modelRuntimeDefaults`.
- Legacy role-specific separate parameters should become dedicated profile
  `runtimeOptions` only where they differ and would otherwise be lost.
- During conversion, set `providerId` only when legacy model/provider state can
  be safely mapped to a first-class provider.
- Legacy models that map to official OpenAI, Anthropic, Google, or Vertex model
  info should receive the matching `providerId`.
- Legacy `reverse_proxy` should convert to `providerId: 'custom-api'` only when
  it is OpenAI-compatible and has enough fields to map safely.
- Legacy providers outside first-class scope should convert to compatibility
  profiles rather than pretending to be first-class provider profiles.
- Do not add a fake compatibility `providerId`.
- Leave `providerId` absent for compatibility profiles that cannot be safely
  mapped to a first-class provider.
- Compatibility should be a UI/resolution status, not a provider category.
- Prefer implementing legacy-to-profile conversion as a dedicated atomic
  command/action.
- If a dedicated command is impractical, use a single revision-safe settings
  patch containing all affected fields as the fallback.

## Role Binding

- Roles tab should be the role routing and overview surface.
- Roles tab should use the canonical `MODEL_ROLES` order.
- Each role row/card should show role name, binding mode, effective profile
  name, provider/model, status, and fallback count.
- Role rows should indicate inherited source when in inherit mode.
- Editing role binding should open a drawer or modal.
- The Resolved Profile summary should remain as compact status/preview, not the
  center of editing.
- Roles can bind to shared Durable Profiles.
- Multiple roles may point at the same profile.
- Editing a shared profile updates every role using it.
- Profile usage must be visible in the profile list/editor.
- When switching an inherited role to profile mode, offer:
  - select existing profile
  - create from inherited profile
  - create new blank/default profile
- Inherit means the role uses exactly the source role's resolved profile
  configuration.
- Inherited roles should not have their own overrides; switch them to a profile
  when different behavior is needed.
- No profile-to-profile inheritance in this phase.
- Deleting an in-use profile should open a reassignment dialog rather than
  silently changing roles or hard-blocking deletion.
- Main Chat and Auxiliary cannot inherit, so deletion reassignment for those
  roles must choose another profile or a compatibility escape hatch.
- Delete reassignment should offer another existing profile for each affected
  role.
- Roles that support inherit can choose Inherit during delete reassignment.
- Main Chat and Auxiliary cannot choose Inherit during delete reassignment.
- Do not offer Legacy by default in delete reassignment for profile-first
  states.
- If Main Chat or Auxiliary has no valid existing replacement profile, show an
  error explaining that deletion cannot proceed until the user creates a new
  profile and reassigns the role manually.
- Legacy role binding should not be shown as a normal option for profile-backed
  states; keep it as compatibility/deemphasized behavior for legacy states.
- Role binding Apply can use a single revision-safe settings patch when only
  bindings change.
- When changing role binding also creates a profile, prefer an atomic
  create-and-bind command/action.
- Avoid client-side multi-step create-then-bind flows when they can leave unused
  profiles or broken bindings after partial failure.

## Profile Editing

- Profiles tab should be the profile authoring surface.
- Profiles tab should show Runtime Defaults at the top or in a clear section.
- Profiles tab should list profiles with name, provider, model/request model,
  status, and used-by roles.
- Profile list actions should include create, edit, duplicate, and delete.
- Profile editor should open in a drawer or modal with explicit Save/Cancel.
- Keep the layout compact and work-focused, avoiding nested cards inside cards.
- The full editor should be provider-first:
  - profile name
  - provider/category
  - model/request model
  - provider-specific configuration
  - runtime overrides
  - fallbacks
  - usage/role bindings summary
- Provider-specific sections should be contextual to the selected provider.
- Expand the durable `modelProfiles` record shape to explicitly support
  provider-first configuration instead of squeezing the editor through
  `modelId` plus inferred legacy provider behavior.
- Add a top-level `providerId` field to Durable Profiles as the explicit
  provider/category selector.
- Prefer `providerId` over overloading `providerOptions.provider`, because the
  latter can already mean provider hints or filters in provider-specific
  contexts.
- New profile editor-authored profiles should always write `providerId`.
- Validators/normalizers should accept missing `providerId` for compatibility
  with existing/imported profiles.
- Normalization should not invent `providerId` unless default generation or
  legacy conversion does it deliberately.
- Profiles missing `providerId` should be treated as Compatibility unless they
  can be safely inferred into a first-class provider path.
- Keep `modelId`, add `providerId`, and expand the existing `providerOptions`
  shape for provider-first fields.
- Do not introduce a separate parallel `providerConfig` tree in the first
  implementation.
- Add request-affecting and required UX fields to the profile record shape, but
  avoid decorative metadata.
- Avoid adding `createdAt` solely for sorting unless implementation proves it is
  needed; array order is acceptable for initial profile list ordering.
- Profile list should preserve `modelProfiles` array order.
- Generated Main Chat and Auxiliary profiles should be inserted first for
  new/default conversion.
- Newly created profiles should append to the end.
- Duplicated profiles should insert after the original profile.
- Active Durable Profiles should be dispatch-self-contained.
- Profile-owned provider/request settings are the source of truth for
  profile-bound roles.
- Legacy/global provider fields should not be hidden inputs for active profiles.
- Blank request model may mean "use the selected model default/internal id."
- Missing required fields should mark the profile incomplete rather than borrow
  from legacy/global settings.
- Profile and role status should use four buckets:
  - Ready
  - Incomplete
  - Compatibility
  - Unsupported
- Compatibility means the state uses a legacy, placeholder, or
  non-first-class-provider path.
- Unsupported means the resolver/preflight cannot route or use the profile.
- First-pass profile completeness should require:
  - `openai`: model and profile-local API key
  - `anthropic`: model and profile-local API key
  - `google`: model and profile-local API key
  - `vertex`: model, project ID, region, client email, and private key
  - `custom-api`: URL/base URL/endpoint and request model
- Custom API key is optional because many local OpenAI-compatible servers do
  not require authentication.
- Incomplete profiles can be saved.
- Active incomplete profiles should be clearly flagged and generation should
  fail early or be blocked by preflight.
- Browser generation flow should block before starting when the active resolved
  profile is incomplete or unsupported, with a clear role/profile reason.
- Server generation routes should also reject incomplete or unsupported active
  resolved profiles with a clear 4xx error.
- Profile-bound roles should not silently fall back to legacy fields when their
  selected profile is incomplete.
- An explicit role binding to a missing profile should be shown as a broken
  profile binding state, not as silently valid legacy behavior.
- Generation should block/fail early when an explicit profile binding points to
  a missing profile.
- Legacy fallback should apply only for explicit legacy mode or safe
  normalization/conversion of legacy data, not for broken explicit profile
  bindings.

## Runtime Defaults And Parameters

- Settings -> Model should become tabbed: Roles and Profiles.
- Replace the old Parameters tab with profile-centered parameter editing.
- Add a Runtime Defaults section in the Profiles tab.
- Runtime Defaults provide shared generation defaults.
- Runtime Defaults editing should use explicit Save/Cancel rather than silent
  autosave.
- Add a new explicit durable Runtime Defaults storage field, such as
  `modelRuntimeDefaults`.
- `modelRuntimeDefaults` should use the same runtime option schema as profile
  `runtimeOptions`.
- Runtime Defaults should not be stored by silently editing legacy flat
  parameter fields in the new UI.
- Profiles store optional runtime overrides, not mandatory full parameter
  copies.
- Clearing a profile override returns the field to Runtime Defaults behavior.
- Legacy flat parameter fields remain compatibility/conversion fallback data.
- Runtime resolution for profile-bound roles should use:
  1. app/runtime hard defaults when no configured value exists
  2. `modelRuntimeDefaults`
  3. profile `runtimeOptions`
- Legacy flat and separate parameter behavior should apply only to legacy-mode
  roles and conversion, not to active profile-bound roles.
- New/default generated Main Chat and Auxiliary profiles should not duplicate
  shared generation parameters.
- Shared generation parameters should initialize into `modelRuntimeDefaults`;
  generated profiles should focus on provider/model/profile-local settings.
- Provider credentials/config should not have a shared default layer in this
  phase; provider identity stays profile-local.

## Secrets

- Use profile-local secrets now.
- Keep the secret UI/component design open to a future shared credential store.
- Existing masked profile secrets should be preserved unless changed or cleared.
- Existing profile secrets should never be revealed in the UI.
- If an existing masked secret field is untouched, preserve the existing secret.
- If the user enters a new secret value, replace the existing secret.
- If the user leaves the secret input empty, clear the existing secret on save.
- Clearing a required provider secret is allowed, but the profile should become
  Incomplete and active generation should be blocked until fixed.
- Duplicating a profile should not copy secrets by default.
- Duplicate profile flow should offer an explicit include-secrets option.
- Duplicating a profile creates a new opaque profile `id`.
- Duplicate default name should be the original profile name plus a localized
  copy suffix.
- Duplicate copies provider/model/runtime/fallback configuration.
- Duplicate does not copy role usage/bindings.
- If include-secrets is false, remove `providerOptions.apiKey` and any future
  profile-local secret fields.
- If include-secrets is true, preserve secrets through the server-side masking
  flow safely.

## Fallbacks

- Fallbacks should support both profile refs and raw model ids during
  compatibility.
- Raw model-id fallback records should use `{ mode: 'model', modelId: string }`.
- Use `mode: 'model'` rather than `legacy` so fallback item type does not get
  confused with role binding legacy mode.
- Profile refs are the recommended/default fallback path.
- Raw model-id fallbacks remain supported for compatibility and quick one-offs.
- The default fallback add action should be Add fallback profile.
- Adding a raw model-id fallback should be an advanced option in the fallback
  editor.
- Existing raw model fallbacks should display and edit normally.
- Raw model-id fallbacks should use static-model-style compatibility behavior.
- Raw model-id fallbacks should not inherit the failed primary profile's
  provider settings.
- Use fallback profile refs when provider-specific fallback configuration is
  needed.
- Fallback profiles use their own full provider/request/runtime configuration.
- A fallback profile should not silently inherit runtime or provider settings
  from the failed primary profile.

## Custom And Dynamic Providers

- The first full editor implementation should only provide first-class
  provider panels for:
  - `openai`
  - `anthropic`
  - `google`
  - `vertex`
  - `custom-api`
- Other current routable provider families should remain compatibility-only
  until added deliberately with field mapping, validation, resolver support, UI,
  and tests.
- Existing profiles or legacy data resolving to providers outside the
  first-class set should show a compatibility placeholder rather than breaking.
- Compatibility-placeholder profiles can be renamed, duplicated, deleted, and
  reassigned.
- Compatibility-placeholder profiles should show resolved summary and a
  compatibility notice.
- Do not expose partial provider-specific editing for compatibility-placeholder
  providers in the first pass.
- A future conversion action to Custom API can be added for legacy custom or
  OpenAI-compatible compatibility cases, but it is not required in this pass.
- `openai` means the official OpenAI API/models only in this first pass.
- Non-OpenAI OpenAI-compatible endpoints should use `custom-api`, not the
  `openai` provider category.
- `google` and `vertex` are separate provider categories.
- `google` means the Gemini API key flow with profile-local API key settings.
- `vertex` means the Vertex AI flow with profile-local Vertex auth/config.
- Keep their boundary explicit because authentication differs and supported
  model ranges can differ.
- First-pass official provider fields should stay minimal and provider-native:
  - `openai`: model, optional request model override, profile-local API key
  - `anthropic`: model, optional request model override, profile-local API key
  - `google`: model, optional request model override, profile-local API key
  - `vertex`: model, optional request model override, project ID, region,
    client email, private key
- Store Vertex auth/config under `providerOptions.vertex`.
- Treat `providerOptions.vertex.privateKey` as a profile-local secret-like
  field: never reveal it, preserve if untouched, replace if typed, and clear if
  left empty on save.
- Include Vertex private keys in profile-local secret masking/preservation.
- Official providers should not support custom base URL/endpoint overrides in
  this first pass.
- If the base URL/endpoint changes, treat that as a different provider surface
  and use `custom-api` instead.
- Request model override should be available for official providers, but placed
  in an advanced subsection.
- By default, official providers should send the selected model's
  internal/default request id.
- Official provider model pickers should allow advanced/manual model-id entry
  for models not yet present in the built-in list.
- Picking from known provider models should remain the normal path.
- Custom API should be a first-class Durable Profile provider/category.
- In the first implementation, Custom API should support OpenAI-compatible Chat
  Completions only.
- Defer OpenAI Responses API, Anthropic-compatible Messages API, and
  Google/Gemini-compatible Custom API formats.
- Custom API profiles should own URL/base URL/endpoint, request model,
  profile-local key, headers, additional params, tokenizer/capability fields as
  needed, runtime overrides, and fallbacks.
- Custom API additional headers and additional params should be structured
  key/value rows in profile-native UI/data.
- Store Custom API headers as `providerOptions.extraHeaders`.
- Store Custom API additional params as `providerOptions.additionalParams`.
- UI should present both as editable rows and validate blank or duplicate keys.
- Existing raw text additional-param formats should be treated as compatibility
  input and parsed/mapped where needed.
- Custom API UI should collect a base URL, and the app should append
  `/chat/completions` for OpenAI-compatible requests.
- If the Custom API base URL input appears to include `/chat/completions`, show
  a warning that routing may be incorrect because the app appends that path.
- Custom API should default to sane OpenAI-compatible capabilities.
- Custom API tokenizer/capability flags should be available as advanced
  overrides rather than main-form fields.
- Custom API tokenizer/capability metadata should be provider-owned rather than
  runtime-default-owned.
- Add a provider-owned shape such as `providerOptions.customApi` for Custom API
  tokenizer/capability fields, even if similar legacy fields exist in runtime
  options.
- Custom API should be presented as a provider/category choice, not as the
  internal `reverse_proxy` model id.
- Custom API profiles should use `providerId: 'custom-api'` and a sentinel
  `modelId`, such as `custom-api`.
- The actual Custom API wire model should live in
  `providerOptions.requestModel`.
- Custom Models / `xcustom:::` remain compatibility-only for now.
- The new editor should not create or edit `customModels` catalog rows.
- Existing `xcustom:::` references should show a legacy custom model
  placeholder, with a future possible conversion to Custom API.
- Dynamic model catalogs should use profile-local configuration:
  - OpenRouter uses the profile's OpenRouter key.
  - NanoGPT uses the profile's NanoGPT key/subscription options.
  - Ollama uses the profile's base URL/API key/cloud/local configuration.
- Manual model-id entry should remain available when catalog fetching fails or
  the desired model is not listed.

## Save Model

- Profile editor uses explicit Save and Cancel.
- Closing or canceling with unsaved changes should warn before discarding.
- Role binding changes also use explicit Apply/Cancel.
- Use independent drafts:
  - Roles tab has its own binding draft.
  - Each profile editor has its own draft.
  - Duplicate/delete dialogs are explicit operations.
- Editing a shared, in-use profile does not require an extra confirmation on
  every save, but usage must be visible near the save area.
- Prefer dedicated row-oriented commands/actions for profile create, update,
  duplicate, and delete.
- Profile commands should preserve masked secrets, validate row identity, handle
  delete reassignment, and avoid whole-array lost-update problems.
- Whole-array `modelProfiles` settings patches remain a compatibility path.

## Not In Scope For First Full Editor

- Profile import/export UI.
- Broad import/export migration tooling.
- Profile-to-profile inheritance.
- Shared credential store.
- Custom Models catalog editing.
- Test Profile action.
- Search/filter.
- Tags/favorites.
- Manual profile reordering.
- Profile icons/colors.
- Raw resolved request/debug JSON UI.

Legacy-to-profile conversion UX is in scope. Existing import/export, preset,
loadout, and compatibility preservation should continue underneath.

## Remaining Ambiguities To Resolve

- Detailed legacy-to-profile conversion algorithm.
- Exact command endpoint/request/response shapes for row-oriented profile
  commands.
- Whether generated `mp_` IDs are client-minted with server collision checks or
  server-minted by centralized command helpers.
- Exact prompt assembly threading required so provider-first profiles do not
  inherit stale `db.aiModel` assumptions.
- Whether Custom API headers should ever be treated as secrets, or only
  `providerOptions.apiKey` should be secret-masked for Custom API.
- Exact UI component decomposition after deciding whether to extract a dedicated
  `ModelSettings.svelte` from `BotSettings.svelte`.

## Verification Scope

- Add unit tests for record normalization and validation, including `providerId`,
  raw model fallbacks, and `modelRuntimeDefaults`.
- Add resolver tests for provider-first profile resolution and broken explicit
  profile binding behavior.
- Add command tests for profile create, update, duplicate, delete, conversion,
  and create-and-bind flows.
- Add UI/component tests for Roles and Profiles tab behavior.
- Add server generation/route tests for incomplete and unsupported active
  profile rejection.
- Run Fastify browser smoke with `pnpm dev:agent` after the UI is wired.

## Implementation Checkpoints

1. Data model and validation: `providerId`, expanded provider options, raw
   model fallbacks, and `modelRuntimeDefaults`.
2. Resolver/runtime semantics: provider-first resolution, runtime defaults
   precedence, broken profile binding errors, and incomplete/status helpers.
3. Commands: profile row commands, conversion command, create-and-bind, and
   delete reassignment.
4. UI shell: Settings -> Model tabs, Roles overview, Profiles list,
   compatibility prompt/panel.
5. Profile editor provider panels: OpenAI, Anthropic, Google, Vertex, and
   Custom API.
6. Runtime Defaults editor and fallbacks editor.
7. Generation guardrails and Fastify browser smoke.
