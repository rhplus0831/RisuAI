# Latest Verification

Date: 2026-06-19

This file records the latest validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: browser-local Cohere/Horde/Ooba legacy
  provider-options parity for `requestCohere()`, `requestHorde()`, and
  `requestOobaLegacy()`. Profile-backed Cohere calls now use profile request
  models, URLs, API keys, extra headers, additional params, and profile model-id
  safety-mode decisions. Profile-backed Horde calls now use profile request
  models/API keys and profile/runtime request body values while preserving
  anonymous `0000000000` keys for missing or blank profile keys. Profile-backed
  OobaLegacy calls now use profile base URLs/API keys/runtime fields, require a
  profile base URL before network work, normalize profile URLs to
  `/api/v1/generate` and `/api/v1/stream`, and omit `X-API-KEY` for blank
  profile keys.
- Latest passing commands:
  - `pnpm exec prettier --write --ignore-path /dev/null src/ts/process/request/request.ts src/ts/process/request/tests/cohereHordeOobaLegacyProfileOptions.test.ts docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/SOLVE-NOTE.md docs/plan/model-config-profiles/phases/phase-3-generation-dispatch.md`
    - Result: passed. The command exited 0 and formatted the focused request
      file, new test file, and model-config profile docs.
  - `pnpm exec vitest run src/ts/process/request/tests/cohereHordeOobaLegacyProfileOptions.test.ts src/ts/model/modelProfileResolver.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/providerCapability.test.ts`
    - Result: passed. The requested focused browser request/provider tests
      passed; 5 test files passed and 89 tests passed.
  - `pnpm exec tsc -p tsconfig.client-lib.json`
    - Result: passed. The command exited 0 and rebuilt client declaration
      output for server project references.
  - `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
    - Result: passed. The command exited 0 under strict server TypeScript.
  - `git diff --check`
    - Result: passed. The command exited 0 with no whitespace errors.
- Failed/intermediate commands during this slice:
  - `pnpm exec vitest run src/ts/process/request/tests/cohereHordeOobaLegacyProfileOptions.test.ts`
    initially failed because the first Horde test still expected a mocked
    `sleep()` call while the helper used the real timer. The test was switched
    to fake timers around the Stable Horde polling loop.
  - The focused Cohere/Horde/Ooba legacy test command then passed with 1 test
    file and 7 tests passed before the broader requested validation set was run.
- Residual gaps: Phase 3 generation dispatch is complete. Durable profile
  storage, UI writes, provider secret reshaping, and embedding/auxiliary
  behavior remain deferred to later phases.

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
