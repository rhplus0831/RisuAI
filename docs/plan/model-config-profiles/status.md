# Model Config Profiles Status

Date: 2026-06-20

This workstream is closed after Phase 7 validation. Phase 0 current-contract
capture, Phase 1 read-only profile resolver, Phase 2 preset composition,
Phase 3 generation dispatch, Phase 4 UI/command adapter, Phase 5 custom,
secrets, and auxiliary surface hardening, Phase 6 persisted profiles, and
Phase 7 verification and cleanup are complete. See
[`latest-verification.md`](latest-verification.md).

## Snapshot

- Plan state: closed.
- Current phase: Phase 7 verification and cleanup complete.
- Current implementation state: durable model profile records now exist in
  `Database.modelProfiles`, and durable role bindings now exist in
  `Database.modelRoleProfiles`. Defaults and normalization run on both the
  client and Fastify server. Settings commands validate these profile fields,
  preset/loadout paths preserve them, provider secrets mask profile-local
  `apiKey` values by stable profile id, and generation dispatch resolves
  durable profiles before falling back to legacy flat compatibility fields.
- Phase 6 landed as focused committed slices:
  - `fea509ef6` `feat: scaffold durable model profiles`
  - `b7e21fdac` `feat: resolve durable model profile bindings`
  - `a16e5b9f4` `feat: preserve model profiles in presets`
  - `559553b21` `feat: support profile request models`
  - `b42a3cb14` `feat: support profile provider options`
  - `534b1918f` `feat: support profile api keys`
  - `9235e5850` `feat: support profile runtime options`
  - `a7cee559f` `feat: support profile fallback refs`
  - `64acf9ab2` `feat: support inherited model profile roles`
- Durable profile data flow: profile records own selected model ids,
  provider/request options, runtime options, local API key values, and fallback
  profile refs. Role bindings select profile mode, legacy mode, or inherit mode
  where a role supports inheritance. The resolver prefers durable records and
  role bindings when present, composes the profile-owned selected model/request
  model/provider options/runtime options/api key/fallback refs into the request
  profile, and then falls back through legacy flat fields for compatibility.
- Settings and import compatibility: client and server defaults create empty
  profile records plus default role bindings; command validators reject malformed
  profile arrays/maps and unsupported nested provider/runtime keys; preset,
  split-preset, loadout, bootstrap, projection, and selected generation settings
  paths preserve the durable fields while still accepting older flat shapes.
- UI state: `ModelRoleList.svelte` shows resolved profile summaries and role
  binding state, including inherited role behavior, but it is not yet a full
  durable profile authoring editor. The visible settings UI still edits legacy
  flat compatibility fields. Durable profile records can be created or updated
  through settings command, import, preset, and loadout paths.
- Current compatibility state: flat fields remain the compatibility source and
  fallback path for legacy imports, copied data, and settings surfaces that have
  not moved to durable profile authoring. Static/legacy fallback model ids still
  use flat settings. Memory embeddings remain outside chat model profiles on the
  Hypa/Voyage/custom embedding contract. Durable profile authoring UI is
  deferred.
- Current verification state: Phase 7 final matrix passed, including focused
  profile/resolver/UI tests, settings/preset/loadout tests, browser request
  tests, Fastify generation/memory tests, Fastify browser smoke, and both
  TypeScript checks. Browser smoke validates Fastify browser boot and basic
  settings/projection flows, not durable profile creation/editing through a
  visible editor. See [`latest-verification.md`](latest-verification.md).

## Phase Router

| Phase                                | Status   | Purpose                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: Current Contracts           | Complete | Freeze current role, provider, preset, fallback, masking, static model, and memory behavior.                                                                                                                                                                                                                                                                                                                     |
| Phase 1: Read-Only Profile Resolver  | Complete | Add a shared resolver and compatibility adapter while storage stays flat.                                                                                                                                                                                                                                                                                                                                        |
| Phase 2: Preset Composition          | Complete | Centralize base DB, selected model preset, and selected prompt preset composition.                                                                                                                                                                                                                                                                                                                               |
| Phase 3: Generation Dispatch         | Complete | Adopt resolved profiles in browser and Fastify generation paths. Phase 3 includes server-owned selection/capability/request-model adoption, provider-options parity across Fastify chat dispatch, and retained browser-local provider helper parity for Gemini/Vertex, OpenAI-compatible, Responses, legacy instruct, Anthropic-family, Mistral, Kobold, native Ollama, Cohere, Horde, and Ooba legacy dispatch. |
| Phase 4: UI & Command Adapter        | Complete | Adapt role/profile UI and settings commands while writes target existing fields. Resolved profile summaries now appear in role settings, provider visibility uses resolved profile UI state, split-preset role fields are normalized in command paths, and the model role editor drawer is extracted. Provider panels remain global/flat; deeper move/mirror work is deferred.                                   |
| Phase 5: Custom, Secrets & Auxiliary | Complete | Hardened custom models, masking boundaries, memory, translation, auxiliary roles, MCP, playground subtitles, fallbacks, dynamic catalogs, OpenAI options, and separate-parameter ownership while preserving flat compatibility fields.                                                                                                                                                                           |
| Phase 6: Persisted Profiles          | Complete | Add durable profile records, role bindings, validation/defaults, profile-local masking, preset/loadout preservation, provider/request/runtime options, fallback profile refs, inherited role bindings, and flat-field compatibility fallbacks after derived parity is proven.                                                                                                                                    |
| Phase 7: Verification & Cleanup      | Complete | Run final regression, Fastify browser smoke, docs updates, compatibility caveat capture, and TypeScript proof. Browser smoke covers boot/basic settings flows, not visible durable profile authoring UI.                                                                                                                                                                                                         |

## Closeout Notes

- Keep `modelProfiles` and `modelRoleProfiles` documented as the durable model
  configuration path.
- Keep legacy flat fields documented as compatibility fallbacks until the UI and
  import/preset compatibility stories retire them deliberately.
- Do not claim there is a complete visible durable profile editor yet. Current
  role settings show resolved profile summaries and edit legacy flat fields.
- Treat memory embeddings as explicitly out of scope for chat profiles until a
  future plan moves Hypa/Voyage/custom embedding settings.

## Phase 0 Contract Decisions

- `staticModel` remains a raw model-id bypass. It skips role resolution and
  does not require a stored profile.
- Legacy fallback entries remain raw model ids in flat compatibility paths. The
  durable profile path can also carry fallback profile refs. Static/legacy
  fallback model ids still pass as `staticModel`; coverage pins `xcustom:::`
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
- Memory summary now follows memory-role profile resolution and profile-owned
  provider options. Memory embeddings stay separate for now on Hypa/Voyage/
  custom embedding fields.

## Deferred Work

- Build a visible durable profile authoring UI instead of only showing resolved
  summaries in role settings.
- Decide when each legacy flat provider/model field can be hidden, migrated, or
  removed after import/preset compatibility is no longer needed.
- Decide whether `customModels` should stay a model catalog consumed by profiles
  or move into provider-specific profile records.
- Decide whether prompt preset model overrides should bind roles to alternate
  profiles, patch selected profile fields, or remain explicit legacy overrides
  during compatibility.
- Decide whether memory embeddings eventually join any profile model after the
  chat resolver is proven, since they currently use `hypaModel`,
  `hypaCustomSettings`, `hypaV3Key`, and `voyageApiKey`.
