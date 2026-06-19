# Latest Verification

Date: 2026-06-20

This file records the latest validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: Phase 5 custom, secrets, and auxiliary
  closeout. Phase 5 landed in these committed slices:
  - `82f12a659` `refactor: use profiles for memory summaries`: memory summary
    resolution now uses the derived `memory` profile path, with server tests.
  - `0def07268` `test: pin memory embedding separation`: memory embeddings stay
    on the separate Hypa/Voyage/custom embedding contract instead of joining the
    chat resolver.
  - `05ef40a29` `refactor: pass catalog fetch keys explicitly`: OpenRouter and
    NanoGPT dynamic catalog fetches no longer borrow implicit global keys.
  - `faedc2e9a` `fix: use profile options for openai dispatch variants`:
    Fastify OpenAI-family dispatch variants use resolved profile options.
  - `70946e87c` `fix: use profile-owned openai dispatch options`: retained
    browser OpenAI and legacy Responses helpers use profile-owned options.
  - `246ee6d46` `fix: route suggestions through auxiliary role`: chat
    suggestions use the auxiliary request role.
  - `1e2ee76ee` `fix: route image prompts through auxiliary role`: image prompt
    generation uses the auxiliary request role.
  - `9f3fefce4` `fix: route subtitles through translate role`: playground
    subtitle generation uses the translate role.
  - `89bcc52bf` `fix: scope translation cache to profile`: translation cache
    entries include resolved profile identity.
  - `217df2c14` `test: cover xcustom static fallback options`: fallback
    execution keeps `xcustom:::` static model options covered.
  - `8770e0842` `test: pin mcp ai role routing`: MCP AI access routing is pinned
    to role-aware request behavior.
  - `8af232971` `refactor: resolve auxiliary parameter fallback`: separate
    parameter fallback ownership now resolves through the auxiliary profile path.
- Latest passing commands for this docs/bookkeeping closeout:
  - `pnpm exec prettier --write --ignore-path /dev/null docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/SOLVE-NOTE.md docs/plan/model-config-profiles/phases/phase-4-ui-and-command-adapter.md`
    - Historical Phase 4 result: passed.
  - `pnpm exec prettier --write --ignore-path /dev/null docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/SOLVE-NOTE.md docs/plan/model-config-profiles/phases/phase-5-custom-secrets-and-auxiliary.md`
    - Phase 5 docs-worker result: passed. The command exited 0 and formatted
      the Phase 5 bookkeeping docs.
  - `git diff --check`
    - Phase 5 docs-worker result: passed. The command exited 0 with no
      whitespace errors.
- Known caveat: repo-wide `pnpm check` is still known to fail with
  pre-existing diagnostics. Do not record `pnpm check` as passing for Phase 5
  unless a manager reruns and verifies it separately.
- Residual gaps: Phase 5 custom, secrets, and auxiliary hardening is complete.
  Durable `modelProfiles`, `profileBindings`, schema changes, and migrations
  have not been added. Flat compatibility fields remain the source of truth
  until Phase 6. Profile-local secret masking is deferred to Phase 6; existing
  stable-row, custom-model, and provider masking remains flat and covered by
  existing tests.

## Manager Validation Passed

- `pnpm exec vitest run src/ts/model/modelRoles.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts`
  - Result: passed, 3 files / 63 tests.
- `pnpm exec vitest run src/ts/presetSplit.test.ts src/ts/loadout.test.ts src/ts/server/settingsBridge.svelte.test.ts src/lang/index.test.ts`
  - Result: passed, 4 files / 54 tests.
- `pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lib/ChatScreens/Suggestion.svelte.test.ts src/lib/Playground/PlaygroundSubtitle.sourceLang.svelte.test.ts src/lib/Others/AllSeperateParameters.svelte.test.ts`
  - Result: passed, 5 files / 30 tests.
- `pnpm exec vitest run src/ts/model/openrouter.test.ts src/ts/model/nanogpt.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/openaiProfileOptions.test.ts src/ts/process/request/tests/openaiResponsesLegacyProfileOptions.test.ts src/ts/process/stableDiff.test.ts src/ts/translator/translator.html.test.ts src/ts/translator/translator.cache.test.ts src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/aiaccess.test.ts`
  - Result: passed, 11 files / 101 tests.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/providerCapabilityRoute.test.ts server/fastify/__tests__/providerTransport.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts server/fastify/__tests__/memorySummaryModel.test.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts`
  - Result: passed, 9 files / 365 tests.
- `pnpm smoke:fastify-browser`
  - Result: passed, 5 browser smoke tests.
- `pnpm exec tsc -p tsconfig.client-lib.json`
  - Result: passed.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
  - Result: passed after the client declaration build completed, matching the
    required TypeScript workflow.
- `pnpm exec prettier --write --ignore-path /dev/null docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/SOLVE-NOTE.md docs/plan/model-config-profiles/phases/phase-5-custom-secrets-and-auxiliary.md`
  - Result: passed.
- `git diff --check`
  - Result: passed.

Phase 6 should add persisted profile, profile binding, migration, masking, UI,
and compatibility validation as those fixtures are introduced. Do not add
persisted profile-storage proof before Phase 6 creates that storage.
