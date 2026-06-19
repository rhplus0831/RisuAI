# Phase 6: Persisted Profiles

Status: not started.

Goal: introduce durable reusable model profile records and role bindings only
after the derived resolver, dispatch, presets, UI adapter, and auxiliary paths
are proven.

## Scope

- Add TypeScript types for durable model profiles, role bindings, provider
  option blocks, runtime option blocks, and fallback references.
- Add defaults and normalization on both client and server.
- Add settings command validation for profile arrays/maps and role bindings.
- Add provider secret masking and masked-placeholder resolution for durable
  profile secrets.
- Add import/export, bootstrap projection, selected chat generation settings,
  loadout, and split-preset support for new fields.
- Add read-through compatibility from old flat fields and legacy preset files.
- Keep copied `data` folder and old `.risu` shapes readable during the
  compatibility period.

## Anchors

- `src/ts/storage/database.svelte.ts`
- `server/fastify/src/databaseDefaults.ts`
- `server/fastify/src/routes/commands.ts`
- `src/ts/server/commands.ts`
- `server/fastify/src/providerSecrets.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/commands/presets.ts`
- `src/ts/presetSplit.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `src/ts/loadout.ts`

## Target Shape

The exact shape is a Phase 0 decision. The durable implementation should
support at least:

- `modelProfiles`: stable-id collection or keyed map of profile records.
- `modelRoleProfiles`: canonical role bindings with inherit/profile modes.
- Profile-local provider settings for `reverse_proxy`, OpenAI, OpenRouter,
  NanoGPT, Ollama, key-identifier OpenAI-compatible models, Anthropic, Mistral,
  Cohere, Gemini/Vertex, Horde, Kobold, and Ooba legacy where supported.
- Profile-local runtime settings for fields that directly affect a request.
- Compatibility metadata that lets the resolver distinguish profiles generated
  from legacy flat fields from user-authored profiles.

## Exit Criteria

- New fields are defaulted and normalized in client and server defaults.
- Settings commands accept and validate new fields.
- Secret masking handles nested profile keys with stable row identity.
- Split preset and loadout code can preserve and apply profile fields.
- The resolver prefers durable profile records when present and falls back to
  legacy flat fields when absent.
- Existing flat-field import and legacy preset tests still pass.

## Validation

```bash
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/server/commands.test.ts src/ts/presetSplit.test.ts src/ts/loadout.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/generation.chat.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- Nested secret masking will fail if profile rows lack stable ids.
- Settings patch validation may accept malformed provider option blocks if the
  first pass treats profiles as generic JSON. Prefer targeted validators for
  fields that affect dispatch.
- Introducing storage too early would hide dispatch gaps under migration code.
  Keep this phase last among feature phases.
