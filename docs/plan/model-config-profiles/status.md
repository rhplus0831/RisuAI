# Model Config Profiles Status

Date: 2026-06-20

This workstream is open. Phase 0 current-contract capture, Phase 1 read-only
profile resolver, Phase 2 preset composition, Phase 3 generation dispatch,
Phase 4 UI/command adapter, and Phase 5 custom, secrets, and auxiliary surface
hardening are complete. Phase 6 persisted profiles is next and is not started.
See [`latest-verification.md`](latest-verification.md).

## Snapshot

- Plan state: open.
- Current phase: Phase 5 custom, secrets, and auxiliary surfaces complete;
  Phase 6 persisted profiles next and not started.
- Current implementation state: existing flattened `Database` fields remain the
  compatibility source of truth. `src/ts/model/modelProfileResolver.ts` derives
  read-only profiles from the flat shape, `src/ts/presetSplit.ts` centralizes
  effective model/prompt preset composition, and Phase 3 dispatch paths consume
  resolved profile selection, request models, runtime options, and provider
  options across Fastify and retained browser-local providers. Phase 4 adapted
  the settings-facing experience without adding durable profile storage:
  `ModelRoleList.svelte` shows resolved profile summaries from flat drafts plus
  `DBState`, `BotSettings.svelte` provider visibility consumes
  `modelProfileUiState` resolved profiles, split-preset command create/patch/
  apply paths normalize role and split-model fields, and the role editor drawer
  is extracted into `ModelRoleEditor`. Provider option panels remain
  global/flat for compatibility.
- Phase 5 closed the known auxiliary/custom gaps without changing durable
  storage: memory summaries now resolve through the `memory` profile, memory
  embeddings remain a separate Hypa/Voyage/custom embedding path with regression
  proof, dynamic OpenRouter/NanoGPT catalog fetches receive explicit keys,
  Fastify and browser OpenAI dispatch variants use profile-owned options,
  suggestions and image prompts route through the auxiliary role, subtitles route
  through the translate role, the translation cache is scoped to the resolved
  profile, `xcustom:::` static fallback options are covered, MCP AI access role
  routing is pinned, and separate-parameter fallback ownership resolves through
  the auxiliary profile path.
- Current compatibility state: no durable `modelProfiles`, `profileBindings`,
  schema changes, or migrations have been added. Flat compatibility fields
  remain the source of truth until Phase 6 introduces persisted records.
  Profile-local secret masking is deferred to Phase 6; current stable-row,
  custom-model, and provider masking remains flat and covered by existing tests.
- Current verification state: Phase 5 landed as focused committed slices with
  targeted runtime tests, final grouped Vitest validation, browser smoke, and
  TypeScript proof. See [`latest-verification.md`](latest-verification.md).

## Phase Router

| Phase                                | Status      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: Current Contracts           | Complete    | Freeze current role, provider, preset, fallback, masking, static model, and memory behavior.                                                                                                                                                                                                                                                                                                                     |
| Phase 1: Read-Only Profile Resolver  | Complete    | Add a shared resolver and compatibility adapter while storage stays flat.                                                                                                                                                                                                                                                                                                                                        |
| Phase 2: Preset Composition          | Complete    | Centralize base DB, selected model preset, and selected prompt preset composition.                                                                                                                                                                                                                                                                                                                               |
| Phase 3: Generation Dispatch         | Complete    | Adopt resolved profiles in browser and Fastify generation paths. Phase 3 includes server-owned selection/capability/request-model adoption, provider-options parity across Fastify chat dispatch, and retained browser-local provider helper parity for Gemini/Vertex, OpenAI-compatible, Responses, legacy instruct, Anthropic-family, Mistral, Kobold, native Ollama, Cohere, Horde, and Ooba legacy dispatch. |
| Phase 4: UI & Command Adapter        | Complete    | Adapt role/profile UI and settings commands while writes target existing fields. Resolved profile summaries now appear in role settings, provider visibility uses resolved profile UI state, split-preset role fields are normalized in command paths, and the model role editor drawer is extracted. Provider panels remain global/flat; deeper move/mirror work is deferred.                                   |
| Phase 5: Custom, Secrets & Auxiliary | Complete    | Hardened custom models, masking boundaries, memory, translation, auxiliary roles, MCP, playground subtitles, fallbacks, dynamic catalogs, OpenAI options, and separate-parameter ownership while preserving flat compatibility fields.                                                                                                                                                                           |
| Phase 6: Persisted Profiles          | Not started | Add durable profile records and role bindings after derived parity is proven.                                                                                                                                                                                                                                                                                                                                    |
| Phase 7: Verification & Cleanup      | Not started | Run final regression, browser smoke, docs updates, compatibility cleanup, and TypeScript proof.                                                                                                                                                                                                                                                                                                                  |

## Immediate Next Steps

1. Start Phase 6 persisted profiles from
   [`phases/phase-6-persisted-profiles.md`](phases/phase-6-persisted-profiles.md).
2. Keep flat fields as the compatibility source of truth while adding durable
   reusable profile records and role bindings.
3. Add profile-local secret masking only after Phase 6 has stable profile
   identity; do not treat the current flat masking path as profile-local.

## Phase 0 Contract Decisions

- `staticModel` remains a raw model-id bypass. It skips role resolution and
  does not require a stored profile.
- Legacy fallback entries remain raw model ids. The request fallback path passes
  each fallback id as `staticModel`; Phase 5 coverage pins `xcustom:::`
  static-fallback option behavior under the active resolved provider settings.
  The legacy `submodel` mode has no fallback key.
- Preset composition remains deterministic: base database -> selected model
  preset -> selected prompt preset. Prompt preset "Others" overrides, including
  `modelRoles`, `seperateModels`, and `fallbackModels`, apply over model
  presets; prompt parameter overrides apply only when
  `overrideModelParameters === true`.
- `doNotChangeSeperateModels` and `doNotChangeFallbackModels` remain legacy
  bot-preset application guards, not general split-preset or profile flags.
- `customModels` remains a model catalog for now. Future derived profiles may
  reference catalog rows by id, but durable migration is deferred.
- Memory summary now follows memory-role resolution and OpenAI-compatible
  provider options. Memory embeddings stay separate for now on
  Hypa/Voyage/custom embedding fields.

## Known Open Decisions

- Whether durable profiles eventually store provider secrets inline, in a nested
  credentials block, or by reference to provider-account records.
- Whether `customModels` should stay a model catalog consumed by profiles or
  move into provider-specific profile records.
- Which legacy fields become profile-local first when Phase 6 introduces
  persisted records, especially OpenAI-compatible, OpenRouter, NanoGPT, Ollama,
  and Custom API options.
- Whether prompt preset model overrides should bind roles to alternate profiles,
  patch selected profile fields, or remain as explicit legacy overrides during
  compatibility.
- Whether memory embeddings eventually join any profile model after the chat
  resolver is proven, since they currently use `hypaModel`,
  `hypaCustomSettings`, `hypaV3Key`, and `voyageApiKey`.
