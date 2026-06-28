# Phase 6: Verification And Docs

Status: complete.

Goal: close the workstream with regression coverage, browser smoke, and updated
structure documentation.

## Completion

Completed on 2026-06-23. The focused final matrix, TypeScript checks,
Prettier, `git diff --check`, and `pnpm dev:agent` browser smoke passed. The
dev server was stopped and ports `6418`/`6419` were confirmed clear.

## Scope

- Run focused client and server suites touched by phases 1-5.
- Run client-lib TypeScript and strict Fastify TypeScript checks.
- Run `git diff --check`.
- Run full-stack browser smoke with `pnpm dev:agent` for:
  - Settings -> Prompt template editor,
  - prompt preset selection,
  - legacy bot preset compatibility/extraction,
  - loadout prompt preset apply,
  - chat generation preview/send path if feasible.
- Stop the dev server after smoke.
- Update:
  - `docs/structure/server-projection-and-bridges.md`,
  - `docs/structure/data-and-events.md`,
  - `docs/structure/providers-and-models.md`,
  - `src/docs/client-runtime.md` if relevant,
  - this workstream's `status.md` and `latest-verification.md`.

## Out Of Scope

- New feature work after ownership cleanup is complete.
- Broad visual redesign.

## Anchors

- `docs/structure/`
- `src/docs/`
- All tests listed in phases 1-5.

## Exit Criteria

- Focused regression suites pass.
- TypeScript checks pass.
- Browser smoke passes and the dev server is stopped.
- Docs record the final owner contract and compatibility caveats.
- `status.md` marks the workstream complete or accurately records remaining
  gaps.

## Validation

Final matrix run:

```bash
pnpm exec vitest run src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/promptTemplateHydration.test.ts src/ts/storage/database.svelte.test.ts src/ts/loadout.test.ts src/ts/presetSplit.test.ts src/ts/presetFieldMirror.test.ts
pnpm exec vitest run src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lib/Setting/Settings.svelte.test.ts src/lib/Setting/pickerGenerationSettings.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverPromptAssembly.test.ts src/ts/process/__tests__/sendChatPromptAssembly.lazyPromptTemplate.test.ts src/ts/process/__tests__/renderFinalPrompt.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandCollectionRange.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/projection.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/templates.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/risuSaveCodec.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

Browser smoke:

```bash
pnpm dev:agent
```

Target: `http://localhost:6418`.

Smoke covered Settings, Prompt Settings, prompt preset switching, the prompt
template editor gate, and the home/chat surface. The current dev data did not
expose a visible legacy Bot Presets UI, so legacy compatibility remains covered
by automated extraction/import/export and loadout tests.

## Risks

- The final matrix may be slow. Keep focused coverage per phase so Phase 6 is a
  confirmation pass, not the first time regressions are discovered.
- Browser smoke should use a throwaway data dir if the workflow mutates settings
  heavily.
