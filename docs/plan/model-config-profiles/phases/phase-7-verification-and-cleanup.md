# Phase 7: Verification & Cleanup

Status: not started.

Goal: close the model config profiles workstream with focused regression,
browser smoke, documentation updates, compatibility cleanup, and TypeScript
proof.

## Scope

- Run all focused resolver, settings, masking, preset, generation, memory,
  auxiliary, and UI tests added during phases 0-6.
- Run the Fastify provider and generation route test matrix.
- Run browser smoke for profile creation/editing, role assignment, Custom API
  per-role settings, and at least one non-Custom API independent provider
  setting flow.
- Audit remaining reads of legacy model/provider flat fields.
- Remove compatibility branches that are no longer needed, or document why they
  remain for import/preset compatibility.
- Update docs under `docs/structure/` and `src/docs/` to describe profiles.
- Update fixture data and tests that still seed only flat fields when profile
  fixtures are more appropriate.
- Update `latest-verification.md`, `status.md`, and `SOLVE-NOTE.md`.

## Anchors

- `rg "aiModel|subModel|modelRoles|forceReplaceUrl|proxyKey|customProxyRequestModel|openrouterRequestModel|nanogptRequestModel|ollama" src server/fastify`
- `docs/structure/providers-and-models.md`
- `src/docs/svelte-ui.md`
- `src/docs/client-runtime.md`
- `server/fastify/__tests__`
- `src/ts/process/__fixtures__`
- `docs/plan/model-config-profiles/latest-verification.md`
- `docs/plan/model-config-profiles/status.md`

## Suggested Final Matrix

Start with:

```bash
pnpm exec vitest run src/ts/model/modelRoles.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/serverChat.test.ts
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/loadout.test.ts src/lang/index.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/providerCapabilityRoute.test.ts server/fastify/__tests__/providerTransport.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/memorySummaryModel.test.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts
pnpm smoke:fastify-browser
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add every new focused test introduced by earlier phases.

## Exit Criteria

- Final matrix passes, or every failure is documented as pre-existing with a
  baseline reproduction.
- Browser smoke proves users can create profiles, assign roles, and use
  independent provider settings.
- Active runtime dispatch no longer reconstructs provider options from global
  flat fields when a profile context exists.
- Remaining flat fields have documented compatibility purpose.
- Structure docs explain the new profile data flow.
- `status.md` marks phases 0-7 complete.
- `latest-verification.md` records exact command output summary.

## Risks

- Provider tests may need stable fake transports for profile-specific endpoints
  and keys to avoid network dependency.
- Browser smoke must use `pnpm dev:agent` and stop the server before finishing.
- Removing flat fields too aggressively can break imported legacy presets or
  copied `data` folders.
