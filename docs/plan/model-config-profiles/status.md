# Model Config Profiles Status

Date: 2026-06-19

This workstream is open. Phase 0 is complete, and the Phase 1 additive resolver
slice is complete with focused resolver validation, client-lib TypeScript, and
strict server TypeScript passing. The workstream is ready for Phase 2 preset
composition; see [`latest-verification.md`](latest-verification.md).

## Snapshot

- Plan state: open.
- Current phase: Phase 1 complete; ready for Phase 2 preset composition.
- Current implementation state: existing flattened `Database` fields remain the
  source of truth. `src/ts/model/modelProfileResolver.ts` now derives a
  read-only legacy profile object from the flat shape, but no runtime dispatch
  consumer has switched to it yet.
- Current compatibility state: no profile data model exists yet.
- Current verification state: Phase 1 focused resolver/regression tests pass;
  client-lib TypeScript passes; full server strict TypeScript passes after the
  `memorySummaryModel.test.ts` custom model fixture was completed. See
  [`latest-verification.md`](latest-verification.md).

## Phase Router

| Phase                                | Status      | Purpose                                                                                             |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------- |
| Phase 0: Current Contracts           | Complete    | Freeze current role, provider, preset, fallback, masking, static model, and memory behavior.        |
| Phase 1: Read-Only Profile Resolver  | Complete    | Add a shared resolver and compatibility adapter while storage stays flat.                           |
| Phase 2: Preset Composition          | Not started | Centralize base DB, selected model preset, and selected prompt preset composition.                  |
| Phase 3: Generation Dispatch         | Not started | Adopt resolved profiles in browser and Fastify generation paths.                                    |
| Phase 4: UI & Command Adapter        | Not started | Adapt role/profile UI and settings commands while writes target existing fields.                    |
| Phase 5: Custom, Secrets & Auxiliary | Not started | Harden custom models, masking, memory, translation, scripts, MCP, playground, fallbacks, and tools. |
| Phase 6: Persisted Profiles          | Not started | Add durable profile records and role bindings after derived parity is proven.                       |
| Phase 7: Verification & Cleanup      | Not started | Run final regression, browser smoke, docs updates, compatibility cleanup, and TypeScript proof.     |

## Immediate Next Steps

1. Move preset composition and then dispatch to the resolver contract before
   changing the database shape.
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
