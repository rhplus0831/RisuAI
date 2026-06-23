# Phase 1: Effective Template Resolver

Status: implemented.

Goal: introduce shared browser/server resolution for the effective prompt
template while keeping rendering behavior stable.

## Scope

- Add server-side effective prompt template resolution used before
  `normalizeTemplate()`.
- Add browser-side equivalent for local/parity prompt assembly and utility
  helpers.
- Prefer prompt preset ownership according to Phase 0 precedence.
- Keep compatibility fallback to top-level `promptTemplate` until later phases
  remove or demote it.
- Update author-note/default helpers that read `db.promptTemplate` directly.
- Add focused tests for:
  - prompt preset wins,
  - top-level fallback still works,
  - legacy bot preset does not unexpectedly win,
  - utility-bot override remains unchanged,
  - no mutation of the stored template during normalization.

## Out Of Scope

- Changing prompt item write commands.
- Changing Prompt Settings UI.
- Removing legacy preset apply/copy behavior.
- Removing `prompt_templates`.

## Anchors

- `server/fastify/src/prompt/templates.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/prompt/staticSections.ts`
- `server/fastify/src/prompt/effectiveGenerationConfig.ts`
- `src/ts/process/promptAssembly/normalizeTemplate.ts`
- `src/ts/process/sendChatPromptAssembly.ts`
- `src/ts/util.ts`
- `src/ts/process/templates/templateCheck.ts`

## Exit Criteria

- Prompt assembly no longer needs to know where the durable owner lives.
- Server and browser resolution agree for the same database/preset inputs.
- Existing prompt-template rendering tests still pass.
- New resolver tests cover precedence and fallback.

## Implementation Notes

- Browser and server prompt assembly resolve the effective template from modern
  prompt preset ownership before using the top-level compatibility fallback.
- Chat-scoped `generationSettings.promptPresetId` wins over the selected/global
  prompt preset for generation reads.
- A resolved modern prompt preset without `promptTemplate` disables template
  rendering instead of borrowing stale top-level compatibility data.
- Resolver coverage includes prompt preset precedence, top-level fallback,
  legacy bot-preset non-ownership, and no mutation during normalization.

## Validation

```bash
pnpm exec vitest run src/ts/process/__tests__/normalizeTemplate.test.ts src/ts/process/__tests__/sendChatPromptAssembly.lazyPromptTemplate.test.ts src/ts/process/__tests__/renderFinalPrompt.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/templates.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/generation.chat.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

## Risks

- Resolver code can accidentally clone too late and mutate preset-owned data.
- Server and browser resolver drift would recreate old parity problems.
- Chat-scoped generation settings can be missed if resolver only looks at
  global `promptPresetsId`.
