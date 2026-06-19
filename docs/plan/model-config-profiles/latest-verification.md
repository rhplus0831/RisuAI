# Latest Verification

Date: 2026-06-19

This file records the latest validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: Phase 0 contract fixtures and documentation.
- Final passing commands:
  - `pnpm exec prettier --write docs/plan/model-config-profiles/phases/phase-0-current-contracts.md docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/storage/database.svelte.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/memorySummaryModel.test.ts`
    - Result: passed. The command exited 0; Prettier reported the touched test
      files unchanged.
  - `pnpm exec prettier --check 'docs/plan/model-config-profiles/**/*.md'`
    - Result: passed. All matched files use Prettier code style.
  - `pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/storage/database.svelte.test.ts`
    - Result: passed. 2 test files passed; 39 tests passed.
  - `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/memorySummaryModel.test.ts`
    - Result: passed. 2 test files passed; 10 tests passed.
  - `git diff --check`
    - Result: passed. No whitespace errors reported.
- Failed/intermediate commands while shaping the fallback fixture:
  - `pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/storage/database.svelte.test.ts`
    - Result: failed. 1 test failed in
      `modelRoleRouting.test.ts`:
      `sends legacy fallback model ids as staticModel attempts before the resolved role model`
      expected `{ type: 'success', result: 'ok', model: 'role-memory-model' }`
      and received `{ type: 'fail', result: 'try another model' }`.
  - `pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/storage/database.svelte.test.ts`
    - Result: failed. 1 test failed in
      `modelRoleRouting.test.ts`:
      `sends legacy fallback model ids as staticModel attempts before the resolved role model`
      expected `{ type: 'success', result: 'ok', model: 'role-memory-model' }`
      and received `{ type: 'success', result: '' }`.
  - `pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts -t "sends legacy fallback" --reporter verbose`
    - Result: failed during fixture refinement. One run expected
      `['model', 'model']` and received `['model']`; a later run expected
      `['fallback-main-model', '']` and received
      `['fallback-main-model']`.
  - `pnpm exec tsx -e "import { setDatabase, getDatabase, type Database } from './src/ts/storage/database.svelte.ts'; globalThis.safeStructuredClone=(v:any)=>v===undefined?undefined:JSON.parse(JSON.stringify(v)); setDatabase({aiModel:'echo_model',subModel:'echo_model',modelRoles:{},characters:[],customModels:[],maxResponse:64,temperature:50,useStreaming:false,genTime:1,extractJson:'',fallbackModels:{model:[],memory:['fallback-memory-model'],emotion:[],translate:[],otherAx:[],scriptMain:[],scriptAux:[]},fallbackWhenBlankResponse:true,requestRetrys:0} as unknown as Database); console.log(JSON.stringify({fallbackModels:getDatabase().fallbackModels,fallbackWhenBlankResponse:getDatabase().fallbackWhenBlankResponse,requestRetrys:getDatabase().requestRetrys}));"`
    - Result: failed before reaching the check with
      `ReferenceError: document is not defined` from
      `src/ts/plugins/pluginSafeClass.ts:311`.
- Residual gaps: no full TypeScript check, full provider matrix, browser smoke,
  or Phase 1 resolver proof has run in this slice. Embedding behavior was not
  migrated or reworked.

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
