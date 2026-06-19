# Model Config Profiles Status

Date: 2026-06-20

This workstream is open. Phase 0 current-contract capture, Phase 1 read-only
profile resolver, Phase 2 preset composition, Phase 3 generation dispatch, and
Phase 4 UI/command adapter are complete. Phase 5 custom, secrets, and auxiliary
surface hardening is next and is not started. See
[`latest-verification.md`](latest-verification.md).

## Snapshot

- Plan state: open.
- Current phase: Phase 4 UI/command adapter complete; Phase 5 custom, secrets,
  and auxiliary surfaces not started.
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
  global/flat for compatibility; further moving or mirroring of provider panels
  is deferred until Phase 5/6 boundaries are safer.
- Current compatibility state: no durable `modelProfiles` or `profileBindings`
  storage exists yet, and none should be added before Phase 6. Flat global
  provider settings must keep working for Phase 5 auxiliary/custom/secrets
  hardening.
- Current verification state: Phase 4 focused UI, command, language, and smoke
  validation has passed. The full repo-wide `pnpm check` command is known to
  fail with pre-existing diagnostics, while the last-touched ModelRole files had
  no changed-file diagnostics. See
  [`latest-verification.md`](latest-verification.md).

## Phase Router

| Phase                                | Status      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: Current Contracts           | Complete    | Freeze current role, provider, preset, fallback, masking, static model, and memory behavior.                                                                                                                                                                                                                                                                                                                     |
| Phase 1: Read-Only Profile Resolver  | Complete    | Add a shared resolver and compatibility adapter while storage stays flat.                                                                                                                                                                                                                                                                                                                                        |
| Phase 2: Preset Composition          | Complete    | Centralize base DB, selected model preset, and selected prompt preset composition.                                                                                                                                                                                                                                                                                                                               |
| Phase 3: Generation Dispatch         | Complete    | Adopt resolved profiles in browser and Fastify generation paths. Phase 3 includes server-owned selection/capability/request-model adoption, provider-options parity across Fastify chat dispatch, and retained browser-local provider helper parity for Gemini/Vertex, OpenAI-compatible, Responses, legacy instruct, Anthropic-family, Mistral, Kobold, native Ollama, Cohere, Horde, and Ooba legacy dispatch. |
| Phase 4: UI & Command Adapter        | Complete    | Adapt role/profile UI and settings commands while writes target existing fields. Resolved profile summaries now appear in role settings, provider visibility uses resolved profile UI state, split-preset role fields are normalized in command paths, and the model role editor drawer is extracted. Provider panels remain global/flat; deeper move/mirror work is deferred.                                   |
| Phase 5: Custom, Secrets & Auxiliary | Not started | Harden custom models, masking, memory, translation, scripts, MCP, playground, fallbacks, and tools.                                                                                                                                                                                                                                                                                                              |
| Phase 6: Persisted Profiles          | Not started | Add durable profile records and role bindings after derived parity is proven.                                                                                                                                                                                                                                                                                                                                    |
| Phase 7: Verification & Cleanup      | Not started | Run final regression, browser smoke, docs updates, compatibility cleanup, and TypeScript proof.                                                                                                                                                                                                                                                                                                                  |

## Immediate Next Steps

1. Start Phase 5 custom, secrets, and auxiliary surface hardening from
   [`phases/phase-5-custom-secrets-and-auxiliary.md`](phases/phase-5-custom-secrets-and-auxiliary.md).
2. Keep durable reusable profile storage deferred until Phase 6; Phase 5 should
   continue using derived profiles plus flat compatibility fields.
3. Keep provider panels global/flat until a Phase 5/6 slice can move or mirror
   them without breaking legacy consumers.
4. Update `status.md` at the end of each phase with proof or explicit gaps.

## Phase 0 Contract Decisions

- `staticModel` remains a raw model-id bypass. It skips role resolution and
  does not require a stored profile.
- Legacy fallback entries remain raw model ids. The request fallback path passes
  each fallback id as `staticModel`; fallback static models borrow the current
  global/provider settings. The legacy `submodel` mode has no fallback key.
- Preset composition remains deterministic: base database -> selected model
  preset -> selected prompt preset. Prompt preset "Others" overrides, including
  `modelRoles`, `seperateModels`, and `fallbackModels`, apply over model
  presets; prompt parameter overrides apply only when
  `overrideModelParameters === true`.
- `doNotChangeSeperateModels` and `doNotChangeFallbackModels` remain legacy
  bot-preset application guards, not general split-preset or profile flags.
- `customModels` remains a model catalog for now. Future derived profiles may
  reference catalog rows by id, but durable migration is deferred.
- Memory summary can later join the chat resolver because it already follows
  memory-role resolution and OpenAI-compatible provider options. Memory
  embeddings stay separate for now on Hypa/Voyage/custom embedding fields.

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
