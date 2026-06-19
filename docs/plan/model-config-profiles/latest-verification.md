# Latest Verification

Date: 2026-06-20

This file records the latest validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: Phase 4 UI and command adapter closeout.
  Phase 4 landed in these slices:
  - `963585eb4` `feat: show resolved model profile summaries`:
    `ModelRoleList.svelte` displays resolved profile summaries from flat drafts
    plus `DBState`, with language/test coverage.
  - `38d5f4cb2` `refactor: resolve profile-aware model settings visibility`:
    `BotSettings.svelte` provider visibility consumes
    `modelProfileUiState` resolved profiles. Browser OpenRouter smoke passed.
  - `e1ff07bc2` `fix: normalize split preset role fields`: split-preset
    create/patch/apply command paths normalize `modelRoles`, `seperateModels`,
    `fallbackModels`, and `seperateParameters`.
  - `ebbdb687f` `refactor: extract model role editor drawer`: the role editor
    drawer is extracted to `ModelRoleEditor`. Touched ModelRole files had no
    changed-file diagnostics.
- Latest passing commands for this docs/bookkeeping closeout:
  - `pnpm exec prettier --write --ignore-path /dev/null docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/SOLVE-NOTE.md docs/plan/model-config-profiles/phases/phase-4-ui-and-command-adapter.md`
    - Result: passed. The command exited 0 and formatted the Phase 4
      bookkeeping docs.
  - `git diff --check`
    - Result: passed. The command exited 0 with no whitespace errors.
- Known caveat: repo-wide `pnpm check` is still known to fail with
  pre-existing diagnostics. Do not record `pnpm check` as passing for Phase 4.
  The Phase 4 drawer extraction slice specifically recorded no diagnostics in
  the last-touched ModelRole files.
- Residual gaps: Phase 4 UI/command adapter is complete. Provider option panels
  remain global/flat for compatibility, and further move/mirror work is
  deferred until safer Phase 5/6 boundaries. Durable `modelProfiles` and
  `profileBindings` storage has not been added and remains deferred until
  Phase 6.

## Remaining Proof

Phase 5 should add focused tests around auxiliary/custom/secrets surfaces as
those slices land, then update this file with exact commands and results. Do
not add persisted profile-storage proof before Phase 6.

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

Add any new focused resolver, custom-model, auxiliary, secret masking, profile
storage, preset, and UI commands as the implementation phases create or modify
those fixtures.
