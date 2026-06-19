# Latest Verification

Date: 2026-06-19

This file records the latest validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: browser-local native Ollama provider-options
  parity for `requestOllama()`. Profile-backed native Ollama calls now use
  `resolvedProfile.providerOptions.ollama` plus common provider options for
  request format, request model, local base URL, cloud API key, model source,
  and thinking mode. Callers without a resolved profile keep the legacy flat
  fallbacks, while profile-backed local native Ollama calls with missing or
  blank URLs fail with `options.ollama.baseUrl is required` before SDK/fetch
  instead of falling back to flat `db.ollamaURL`.
- Latest passing commands:
  - `pnpm exec prettier --write --ignore-path /dev/null src/ts/process/request/request.ts src/ts/process/request/tests/ollamaProfileOptions.test.ts docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/SOLVE-NOTE.md docs/plan/model-config-profiles/phases/phase-3-generation-dispatch.md`
    - Result: passed. The command exited 0 and formatted the focused request
      file, new test file, and model-config profile docs.
  - `pnpm exec vitest run src/ts/process/request/tests/ollamaProfileOptions.test.ts src/ts/model/modelProfileResolver.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/providerCapability.test.ts`
    - Result: passed. The requested focused browser request/provider tests
      passed; 5 test files passed and 85 tests passed.
  - `pnpm exec tsc -p tsconfig.client-lib.json`
    - Result: passed. The command exited 0 and rebuilt client declaration
      output for server project references.
  - `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
    - Result: passed. The command exited 0 under strict server TypeScript.
  - `git diff --check`
    - Result: passed. The command exited 0 with no whitespace errors.
- Failed/intermediate commands during this slice:
  - None. The initial focused Ollama test command passed with 1 test file and 3
    tests passed before the broader requested validation set was run.
- Residual gaps: Full Phase 3 is not complete. Browser role/static/fallback
  selection now uses the resolver, Fastify provider-option slices are complete
  through Gemini/Vertex, browser-local Gemini/Vertex provider-options parity is
  complete, and browser-local `requestOpenAI()` chat-completions
  OpenAI-compatible provider-options parity is complete, and browser-local
  OpenAI Responses/legacy instruct provider-options parity is complete, and
  browser-local Anthropic-family provider-options parity is complete, and
  browser-local Mistral provider-options parity is complete, and browser-local
  Kobold provider-options parity is complete, and browser-local native Ollama
  provider-options parity is complete. Other retained browser-local provider
  helpers, including Cohere, Horde, and Ooba legacy paths, still reconstruct
  provider-specific keys, base URLs, request-model options, and additional params
  from flat database fields. Durable profile storage, UI writes, provider secret
  reshaping, and embedding behavior remain deferred to later phases.

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
