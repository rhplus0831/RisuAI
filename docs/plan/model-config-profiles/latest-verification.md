# Latest Verification

Date: 2026-06-19

This file records the latest validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: Phase 3a server-owned profile
  selection/capability/request-model adoption. Browser server-prompt preflight
  now resolves profiles from the Phase 2 effective model-runtime database;
  Fastify server-intent completion resolves a profile from unmasked server
  settings using `mode` plus optional `staticModel`; Fastify chat dispatch uses
  resolved profiles for provider route, message reformat flags, and provider
  request model while flat provider option branches remain in place.
- Latest passing commands:
  - `pnpm exec vitest run src/ts/model/modelProfileResolver.test.ts src/ts/process/request/tests/serverPromptAssembly.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts`
    - Result: passed. 5 test files passed; 100 tests passed.
  - `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/modelProfileResolver.server.test.ts server/fastify/__tests__/providerCapabilityRoute.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/providerTransport.test.ts`
    - Result: passed. 5 test files passed; 183 tests passed.
  - `pnpm exec tsc -p tsconfig.client-lib.json`
    - Result: passed. The command exited 0 and rebuilt client declaration
      output for server project references.
  - `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
    - Result: passed. The command exited 0 under strict server TypeScript.
  - `pnpm exec prettier --write --ignore-path /dev/null src/ts/model/modelProfileResolver.ts src/ts/model/modelProfileResolver.test.ts src/ts/process/request/serverPromptAssembly.ts src/ts/process/request/tests/serverPromptAssembly.test.ts server/fastify/src/prompt/chatDispatch.ts server/fastify/src/routes/generation.ts server/fastify/__tests__/providerCapabilityRoute.test.ts server/fastify/__tests__/generation.completion.test.ts docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/phases/phase-3-generation-dispatch.md`
    - Result: passed. The command exited 0 and formatted the Phase 3a code,
      tests, and docs.
  - `git diff --check`
    - Result: passed. The command exited 0 with no whitespace errors.
- Failed/intermediate commands during this slice:
  - The first focused browser Vitest bundle failed one new
    `serverPromptAssembly` unknown-id assertion because the test fixture kept
    browser-local legacy textgen defaults. The fixture now clears those endpoint
    defaults for server-preflight tests, and the final bundle passes.
  - The first TypeScript run failed on the new `unsupportedReason` object-literal
    shape and route-helper narrowing. The resolver now attaches
    `unsupportedReason` after `completeModel`, the route helper uses explicit
    profile/info narrowing, and final client/server TypeScript passes.
- Residual gaps: Full Phase 3 is not complete. Remaining browser
  completion/request helper migration, provider-option migration, durable
  profile storage, UI writes, provider secret reshaping, and embedding behavior
  remain deferred to later slices/phases.

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
