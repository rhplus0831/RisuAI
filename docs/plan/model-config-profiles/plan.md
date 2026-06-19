# Model Config Profiles

Date: 2026-06-19

## Goal

Separate model selection from the options associated with the selected model by
introducing reusable model configuration profiles. A model role should resolve
to a profile, and that profile should resolve to a complete generation
configuration: model id, provider route, request model, endpoint, credentials,
format, tokenizer/flags, additional parameters, runtime parameters, tools, and
fallback behavior.

End state:

- Main chat, auxiliary, memory, emotion, translation, other auxiliary, script
  main, and script auxiliary roles can each inherit or select an independent
  profile.
- Multiple profiles can use the same provider family with different settings,
  such as two OpenAI profiles with different keys, two OpenRouter profiles with
  different request models, or two Custom API profiles with different URLs.
- Browser completion, Fastify `/chat`, Fastify server-intent completion, memory
  summaries, scripts, translation, MCP AI access, playground tools, and
  fallbacks all use one profile resolution contract.
- Current flat fields remain readable through a compatibility adapter until
  every consumer is moved and tests prove parity.
- Secret masking, settings commands, preset extraction/application, projection,
  and import/export understand nested profile secrets and stable profile ids.

## Boundary Sources

- `README.md` owns the source-anchor map and read order.
- `status.md` owns the current phase router and open/closed state.
- Phase files own implementation handoff details for each slice.
- The codebase remains the source of truth when line numbers or docs drift.

## Current Problem Shape

The current settings model mixes three concepts in one flat `Database` object:

- Model role selection: `aiModel`, `subModel`, `modelRoles`,
  `seperateModelsForAxModels`, and `seperateModels`.
- Provider connection and request-model settings: `openAIKey`, `proxyKey`,
  `forceReplaceUrl`, `customProxyRequestModel`, `customAPIFormat`,
  `openrouterKey`, `openrouterRequestModel`, `nanogptKey`,
  `nanogptRequestModel`, Ollama fields, Gemini/Vertex fields, provider-specific
  keys, `OaiCompAPIKeys`, and `customModels`.
- Runtime/model options: sampling fields, `additionalParams`,
  `seperateParameters`, `fallbackModels`, `customFlags`, `enableCustomFlags`,
  `modelTools`, tokenizer/template flags, JSON schema options, and streaming
  flags.

This lets roles pick different model ids, but not independent option bundles
for the same provider family.

## Migration Strategy

The safest path is not to persist reusable profile records first. Start by
deriving a profile-like runtime object from the existing flat settings. Then
centralize effective preset composition before moving dispatch to the resolver
contract. UI code can adapt to that contract while writes still target current
fields. Only after parity is proven should the database gain durable profile
records and role bindings.

This keeps the first behavior changes testable against today's `aiModel`,
`subModel`, `modelRoles`, `seperateModels`, `staticModel`, `reverse_proxy`,
`xcustom:::`, provider key, fallback, and preset semantics.

## Target Contract

Every generation-capable surface should resolve through these steps.

### Final Profile Data

A profile is a stable-id record with these conceptual groups:

- Identity: `id`, `name`, optional description, and optional tags.
- Selection: selected registry model id or provider family plus custom model
  metadata.
- Provider options: provider-specific endpoint, API key, request model, format,
  tokenizer, provider routing hints, and additional parameters.
- Runtime options: sampling fields, context/response limits, thinking options,
  streaming preference, schema/output settings, custom flags, and tools.
- Fallbacks: fallback profile ids or legacy fallback model ids during the
  compatibility period.

Profiles may keep secrets inline if masking paths are robust. If the shape
grows, move secret material into a nested `credentials` block or a separate
provider-account table, but the resolver contract should not expose masked
placeholders to runtime dispatch.

### Role Binding

Roles bind to profile ids instead of raw model ids. Binding modes:

- `inherit`: use the role's configured source role, such as auxiliary roles
  inheriting chat auxiliary or script main inheriting chat main.
- `profile`: use a specific profile id.
- `legacy`: compatibility mode for existing `modelRoles` / `seperateModels`
  rows until migration is complete.

### Derived Resolution

Before durable profiles exist, the shared resolver returns the same normalized
runtime object from legacy flat settings. After durable profiles exist, the
resolver keeps that output contract and reads profile records directly.

The normalized runtime object includes:

- `role`: canonical model role.
- `profileId`: stable id or `legacy:<field>` compatibility marker.
- `modelId`: registry model id selected by the profile.
- `modelInfo`: cloned model metadata with profile-level flags/tokenizer applied.
- `provider`: routable provider verdict from the shared capability table.
- `wireModel`: provider request model.
- `providerOptions`: endpoint, API key, headers, auth hints, and parsed
  additional parameters.
- `runtimeOptions`: sampling, response/context limits, schema/output options,
  streaming, tools, and provider-specific toggles.
- `fallbacks`: fallback profile ids or legacy model ids.

The resolver must be pure enough to share between browser preflight and server
dispatch decisions. Runtime paths that need secrets may call a server-side
resolver variant that reads unmasked settings from persisted data.

## Invariants

- Do not add another provider-specific special case directly to
  `requestChatDataMain`, `generation.ts`, or `chatDispatch.ts` unless it is
  behind the shared profile resolver.
- Keep provider capability decisions in
  `src/ts/process/request/providerCapability.ts`; do not fork the table.
- Stable profile ids are required before persisted nested secrets can be masked
  safely.
- Existing `xcustom:::` custom models are a compatibility input, not the final
  abstraction for all providers.
- Fallbacks must say whether they fallback to a profile or to a legacy model id.
  A bare fallback model id cannot reliably carry provider settings.
- Presets and prompt model overrides must not silently mix old flat fields and
  new profiles without deterministic precedence.
- UI strings added for the profile editor must go through `src/lang`.
- Any new route must update `server/fastify/src/routeManifest.ts`.
- Before committing implementation work, run Prettier.

## Phase Overview

- [0. Current Contracts](phases/phase-0-current-contracts.md): freeze role,
  provider, preset, fallback, static model, custom model, masking, and memory
  behavior before extraction.
- [1. Read-Only Profile Resolver](phases/phase-1-read-only-profile-resolver.md):
  add the shared resolver and flat-field compatibility adapter without changing
  persisted storage.
- [2. Preset Composition](phases/phase-2-preset-composition.md): centralize the
  base database, selected model preset, and selected prompt preset merge order.
- [3. Generation Dispatch](phases/phase-3-generation-dispatch.md): move browser
  request routing, server preflight, server-intent completion, and Fastify chat
  dispatch to resolved profiles using the shared composition contract.
- [4. UI & Command Adapter](phases/phase-4-ui-and-command-adapter.md): make the
  role/profile editor reusable while writes still target existing settings
  fields.
- [5. Custom, Secrets & Auxiliary](phases/phase-5-custom-secrets-and-auxiliary.md):
  harden custom models, masking, memory summary, fallback, tools, scripts, MCP,
  translation, and playground surfaces.
- [6. Persisted Profiles](phases/phase-6-persisted-profiles.md): add durable
  profile records, role bindings, import/export, and preset support after
  derived behavior is stable.
- [7. Verification & Cleanup](phases/phase-7-verification-and-cleanup.md): close
  the workstream with regression, browser smoke, documentation updates,
  TypeScript proof, and removal or fencing of legacy-only consumers.

## Risk Priorities

| Priority | Risk | Primary evidence |
| --- | --- | --- |
| P0 | Server and browser dispatch choose different provider options for the same role/profile. | `request.ts`, `serverPromptAssembly.ts`, `generation.ts`, `chatDispatch.ts` |
| P0 | Nested secrets are masked but cannot be resolved on write because profile rows lack stable identity. | `providerSecrets.ts`, `routes/commands.ts`, split preset commands |
| P0 | Presets apply old flat fields after profiles and overwrite role/profile bindings. | `presetSplit.ts`, `splitPresets.ts`, `settingsBridge.svelte.ts`, `loadout.ts` |
| P0 | Fallback model ids lose provider options or borrow the wrong profile settings. | `request.ts`, `ModelRoleList.svelte`, prompt/model preset fallback editors |
| P1 | Memory, scripts, translation, MCP, or playground paths keep reading global `db.aiModel` or provider fields. | `memorySummaryModel.ts`, `translator.ts`, `triggers.ts`, `scriptings.ts`, `aiaccess.ts` |
| P1 | Custom model (`xcustom:::`) and Custom API (`reverse_proxy`) semantics diverge after profiles are introduced. | `CustomModelsSettings.svelte`, `modellist.ts`, provider dispatch helpers |
| P1 | Dynamic model catalog fetching still depends on one global key and cannot fetch per-profile catalogs. | `modellist.ts`, OpenRouter/NanoGPT/Ollama UI helpers |
| P2 | Old UI panels remain visible globally and confuse users about which profile owns a setting. | `BotSettings.svelte`, `ModelRoleList.svelte` |

## Not In This Plan

- No attempt to redesign non-generation image, TTS, or embedding settings unless
  a phase explicitly brings that surface under model profiles.
- No removal of legacy flat fields until the compatibility adapter and runtime
  parity tests are complete.
- No provider marketplace or account-management redesign beyond what profile
  resolution requires.
- No new database migration is required up front because the Fastify variation
  is unreleased, but import/default normalization must still handle copied data
  and old preset files.
- No landing-page or broad settings visual redesign. UI work should create the
  usable profile editor and keep existing settings conventions.
