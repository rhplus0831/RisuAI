# Latest Verification

Date: 2026-06-19

This file records the latest validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: Phase 3i Fastify Gemini/Vertex
  provider-options adoption. `resolveModelProfile()` now exposes Google AI
  Studio profile keys as `profile.providerOptions.apiKey` from
  `database.google?.accessToken`, and Vertex service-account auth as
  `profile.providerOptions.vertex` from `database.google?.projectId`,
  `database.vertexRegion`, `database.vertexClientEmail`, and
  `database.vertexPrivateKey`. The resolver intentionally does not treat
  `database.vertexAccessToken` as a profile credential. Fastify Gemini chat
  dispatch now passes Google API key and Vertex auth only from
  `profile.providerOptions`, not flat `db.google` / `db.vertex*` fields.
  Dispatch coverage proves conflicting flat Google and Vertex credentials do
  not override the profile, missing or blank Google profile keys and
  missing/partial Vertex profile auth do not fall back to flat DB credentials or
  call `fetch`, Vertex token exchange plus prediction URL use profile
  project/region/service-account data, and profile-derived Gemini request-model
  behavior, including `models/` stripping, remains intact. Phase 3 remains in
  progress because browser completion/request helper migration still remains.
- Latest passing commands:
  - `pnpm exec vitest run src/ts/model/modelProfileResolver.test.ts`
    - Result: passed. 1 test file passed; 20 tests passed.
  - `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts server/fastify/__tests__/gemini.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/generation.completion.test.ts`
    - Result: passed. 4 test files passed; 229 tests passed.
  - `pnpm exec tsc -p tsconfig.client-lib.json`
    - Result: passed. The command exited 0 and rebuilt client declaration
      output for server project references.
  - `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
    - Result: passed. The command exited 0 under strict server TypeScript.
  - `pnpm exec prettier --write --ignore-path /dev/null src/ts/model/modelProfileResolver.ts src/ts/model/modelProfileResolver.test.ts server/fastify/src/prompt/chatDispatch.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/phases/phase-3-generation-dispatch.md`
    - Result: passed. The command exited 0 and formatted the Phase 3i code,
      tests, and docs.
  - `git diff --check`
    - Result: passed. The command exited 0 with no whitespace errors.
- Failed/intermediate commands during this slice: none.
- Residual gaps: Full Phase 3 is not complete. Remaining browser
  completion/request helper migration, durable profile storage, UI writes,
  provider secret reshaping, and embedding behavior remain deferred to later
  slices/phases. OpenRouter body knobs (`fallback`, `middleOut`, and provider
  filters) are not wired into Fastify chat dispatch because the existing OpenAI
  chat adapter does not expose those request-body options.

## Remaining Proof

Future implementation phases should run the smallest focused tests listed in
each phase file, then update this file with exact commands and results.

Final closeout should include:

```bash
pnpm exec vitest run src/ts/model/modelRoles.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec vitest run src/ts/presetSplit.test.ts src/ts/loadout.test.ts src/ts/server/settingsBridge.svelte.test.ts src/lang/index.test.ts
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/serverChat.test.ts src/ts/translator/translator.html.test.ts src/ts/process/mcp/mcp.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/providerCapabilityRoute.test.ts server/fastify/__tests__/providerTransport.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/memorySummaryModel.test.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts
pnpm smoke:fastify-browser
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add any new focused resolver, profile-storage, preset, secret masking, and UI
commands as the implementation phases create or modify those fixtures.
