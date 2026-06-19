# Model Config Profiles Status

Date: 2026-06-19

This workstream is open. Phase 0 is complete, the Phase 1 additive resolver
slice is complete, the Phase 2 preset composition slice is complete, the Phase
3a server-owned profile selection/capability/request-model slice is complete,
the Phase 3b Fastify OpenAI-compatible provider-options slice is complete, and
the Phase 3c Fastify Anthropic/Mistral/Cohere provider-options slice is
complete. The Phase 3d Fastify native Ollama provider-options slice is
complete. The broader Phase 3 generation dispatch phase remains in progress; see
[`latest-verification.md`](latest-verification.md).

## Snapshot

- Plan state: open.
- Current phase: Phase 3 generation dispatch in progress; Phase 3a complete;
  Phase 3b Fastify OpenAI-compatible provider-options slice complete; Phase 3c
  Fastify Anthropic/Mistral/Cohere provider-options slice complete; Phase 3d
  Fastify native Ollama provider-options slice complete.
- Current implementation state: existing flattened `Database` fields remain the
  source of truth. `src/ts/model/modelProfileResolver.ts` now derives a
  read-only legacy profile object from the flat shape, and
  `src/ts/presetSplit.ts` now provides the shared effective preset composition
  helper used by browser server-prompt preflight and Fastify prompt assembly.
  Browser server-prompt preflight, Fastify server-intent completion selection,
  and Fastify chat dispatch provider routing/message flags/request model now
  use resolved profiles for the Phase 3a server-owned slice. Fastify chat
  dispatch now also uses `profile.providerOptions` for OpenAI-compatible
  provider branches `openai`, `openrouter`, and `nanogpt`, including
  `reverse_proxy`, `xcustom:::`, key-identifier models, and `ollama-cloud`
  routed through OpenAI-compatible chat. Fastify chat dispatch also uses
  `profile.providerOptions` for Anthropic, Mistral, and Cohere `apiKey`,
  `baseUrl`, and `additionalParams`, plus Mistral/Cohere `extraHeaders`, where
  those adapter fields already exist. Cohere safety-mode derivation now reads
  the resolved profile model id instead of flat `db.aiModel`. Fastify native
  Ollama dispatch now uses `profile.providerOptions.ollama.url` or
  `profile.providerOptions.baseUrl` plus the resolved profile request model
  instead of flat `db.ollamaURL`/`db.ollamaModel`. Outside those dispatch slices,
  remaining provider credentials, base URLs, additional params, durable storage,
  and UI writes remain on the existing flat fields.
- Current compatibility state: no profile data model exists yet.
- Current verification state: Phase 3d focused Fastify chat
  dispatch/completion/chat tests pass; focused browser capability,
  server-completion, and model-role routing tests pass; client-lib TypeScript
  passes; full server strict TypeScript passes. See
  [`latest-verification.md`](latest-verification.md).

## Phase Router

| Phase                                | Status      | Purpose                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: Current Contracts           | Complete    | Freeze current role, provider, preset, fallback, masking, static model, and memory behavior.                                                                                                                                                                                                                     |
| Phase 1: Read-Only Profile Resolver  | Complete    | Add a shared resolver and compatibility adapter while storage stays flat.                                                                                                                                                                                                                                        |
| Phase 2: Preset Composition          | Complete    | Centralize base DB, selected model preset, and selected prompt preset composition.                                                                                                                                                                                                                               |
| Phase 3: Generation Dispatch         | In progress | Adopt resolved profiles in browser and Fastify generation paths. Phase 3a server-owned selection/capability/request-model, Phase 3b Fastify OpenAI-compatible provider-options, Phase 3c Fastify Anthropic/Mistral/Cohere provider-options, and Phase 3d Fastify native Ollama provider-options slices complete. |
| Phase 4: UI & Command Adapter        | Not started | Adapt role/profile UI and settings commands while writes target existing fields.                                                                                                                                                                                                                                 |
| Phase 5: Custom, Secrets & Auxiliary | Not started | Harden custom models, masking, memory, translation, scripts, MCP, playground, fallbacks, and tools.                                                                                                                                                                                                              |
| Phase 6: Persisted Profiles          | Not started | Add durable profile records and role bindings after derived parity is proven.                                                                                                                                                                                                                                    |
| Phase 7: Verification & Cleanup      | Not started | Run final regression, browser smoke, docs updates, compatibility cleanup, and TypeScript proof.                                                                                                                                                                                                                  |

## Immediate Next Steps

1. Continue Phase 3 by moving remaining browser completion/request helpers and
   provider option branches outside OpenAI-compatible, Anthropic, Mistral,
   Cohere, and native Ollama to the resolver contract without reshaping provider
   secrets or storage.
2. Keep UI writes targeting existing fields until the profile editor behavior
   is proven.
3. Update `status.md` at the end of each phase with proof or explicit gaps.

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
