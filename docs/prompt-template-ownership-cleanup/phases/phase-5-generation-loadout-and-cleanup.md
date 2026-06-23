# Phase 5: Generation Loadout And Cleanup

Status: pending.

Goal: align generation, loadouts, and remaining compatibility paths with prompt
preset ownership, then remove stale top-level ownership assumptions.

## Scope

- Ensure server chat generation resolves prompt templates from prompt preset
  selection without stale top-level fallback except where intentionally
  compatible.
- Ensure browser local/parity assembly follows the same resolver.
- Ensure loadouts save/apply prompt preset ids and do not depend on legacy bot
  preset prompt-template copying.
- Revisit `presetFieldMirror` so prompt-template fields are no longer mirrored
  through a top-level field as the normal path.
- Remove or quarantine top-level `prompt_templates` write paths that are no
  longer needed.
- Update bootstrap/projection tests for the final lazy-body contract.
- Update docs under `docs/structure/` and `src/docs/` if the live architecture
  changes.

## Out Of Scope

- Removing legacy bot presets entirely.
- Removing all compatibility fields from imported saves.
- UI redesign beyond cleanup caused by ownership changes.

## Anchors

- `server/fastify/src/prompt/effectiveGenerationConfig.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/prompt/templates.ts`
- `server/fastify/src/routes/generationChat.ts`
- `src/ts/process/sendChatPromptAssembly.ts`
- `src/ts/process/request/serverPromptAssembly.ts`
- `src/ts/loadout.ts`
- `src/ts/presetFieldMirror.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`

## Exit Criteria

- Generation uses prompt preset ownership in server and browser paths.
- Loadout apply cannot accidentally restore a stale top-level template.
- Top-level prompt-template persistence is either removed or explicitly
  compatibility-only.
- Structure docs describe prompt preset ownership accurately.

## Validation

```bash
pnpm exec vitest run src/ts/loadout.test.ts src/ts/process/request/tests/serverPromptAssembly.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChatPromptAssembly.lazyPromptTemplate.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/templates.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/projection.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

## Risks

- Generation config currently composes chat-scoped prompt preset settings; any
  cleanup must preserve that precedence.
- Removing top-level fallbacks before all consumers migrate will fail in less
  common preview/local paths.
- Bootstrap and projection body-cache assumptions may need careful updates.
