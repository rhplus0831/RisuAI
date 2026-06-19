# Latest Verification

Date: 2026-06-19

This file records the latest validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: browser-local Gemini/Vertex provider-options
  parity. `requestChatDataMain()` now attaches the already resolved profile to
  `RequestDataArgumentExtended`. The retained browser-local Google helper now
  uses `resolvedProfile.providerOptions.requestModel` for Studio and Vertex
  wire URLs, `resolvedProfile.providerOptions.apiKey` for Google AI Studio, and
  `resolvedProfile.providerOptions.vertex` for Vertex project/region/service
  account credentials when a resolved profile is present. Profile-backed Vertex
  requests generate the bearer from profile service-account credentials instead
  of letting flat cached `db.vertexAccessToken` bypass conflicting profile
  credentials. Legacy flat fallbacks remain for callers without a resolved
  profile, and `requestServerCompletion()` payload shape remains unchanged.
- Latest passing commands:
  - `pnpm exec prettier --write --ignore-path /dev/null src/ts/process/request/request.ts src/ts/process/request/google.ts src/ts/process/request/tests/google.fastify.test.ts docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/phases/phase-3-generation-dispatch.md docs/plan/model-config-profiles/SOLVE-NOTE.md`
    - Result: passed. The command exited 0 and formatted the focused request
      files and model-config profile docs.
  - `pnpm exec vitest run src/ts/process/request/tests/google.fastify.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/providerCapability.test.ts`
    - Result: passed. 4 test files passed; 65 tests passed.
  - `pnpm exec tsc -p tsconfig.client-lib.json`
    - Result: passed. The command exited 0 and rebuilt client declaration
      output for server project references.
  - `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
    - Result: passed. The command exited 0 under strict server TypeScript.
  - `git diff --check`
    - Result: passed. The command exited 0 with no whitespace errors.
- Failed/intermediate commands during this slice:
  - `pnpm exec vitest run src/ts/process/request/tests/google.fastify.test.ts --reporter verbose`
    - Result: failed once while adding coverage because the browser test
      environment's Buffer polyfill does not support the `base64url` encoding
      label. The test was corrected to decode JWT payloads with explicit
      base64url normalization, then the same focused command passed.
- Residual gaps: Full Phase 3 is not complete. Browser role/static/fallback
  selection now uses the resolver, and Fastify provider-option slices are
  complete through Gemini/Vertex. Browser-local Gemini/Vertex provider-options
  parity is now complete for API key, Vertex service-account auth, cached token
  avoidance, and request-model URL selection. Other retained browser-local
  provider helpers still reconstruct many provider-specific keys, base URLs,
  request-model options, and additional params from flat database fields.
  Durable profile storage, UI writes, provider secret reshaping, and embedding
  behavior remain deferred to later phases. OpenRouter body knobs (`fallback`,
  `middleOut`, and provider filters) are not wired into Fastify chat dispatch
  because the existing OpenAI chat adapter does not expose those request-body
  options.

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
