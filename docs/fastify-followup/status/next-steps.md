# Next Steps

Date: 2026-05-27

Use this file as the pickup runbook for the reopened audit work. The
phase files under `../phases/` hold source evidence and exit criteria.

Policy note: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly rather than preserving intermediate
Fastify shapes.

## Immediate Pickup

Pick one slice per work session. Each slice should leave the worktree in
a reviewable state with focused tests, update the affected phase file,
and add any longer closeout note under `../phases-completed/`.

1. Phase 8 memory ownership is the next default pickup now that Phase 7
   prompt assembly has closed.
   - 8A: stable custom embedding job model key. Landed.
   - 8B: production memory progress event delivery. Pick this next.
   - 8C: missing-summary follow-ups for chunks with no embedding yet.

2. Phase 6 streaming errors should land before broad generation
   closeout.
   - 6A: streaming error frame contract plus OpenAI-compatible failure
     handling.
   - 6B: Anthropic, Mistral, and Gemini stream failure alignment.
   - 6C: Ollama stream failure alignment and final provider audit.

3. Phase 0 and Phase 3 are small independent cleanup slices.
   - 0A: Google Drive public artifact removal.
   - 3A: shared or explicitly aligned proxy response-header filtering.

## Recently Closed

Phase 9 client-thinning follow-up closed in slices 9A-9J. The final
direct-write sweep is anchored at `67a9dab4`.

Phase 7 prompt assembly follow-up closed in slices 7A-7E.

- 7A: landed browser regenerate request wiring.
- 7B: landed server regenerate assembly semantics.
- 7C: landed `/chat` provider dispatch guards.
- 7D: landed stop-trigger mutation payload delivery.
- 7E: route-backed fixture coverage for send, continue, regenerate,
  preview, and preview-prompt.

Phase 8 memory follow-up has started.

- 8A: stable custom embedding job model key and custom wire-model
  routing.

## Suggested Verification

Closed Phase 9 reference verification:

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json
```

Add focused suites when the touched surface has one:

```bash
pnpm exec vitest run src/ts/plugins/plugins.test.ts
pnpm smoke:fastify-browser
```

Closed Phase 7 reference verification:

```bash
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/providerTransport.test.ts
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
```

Focused Phase 8:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/assemble.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts server/fastify/__tests__/memoryEmbedJobHandler.test.ts
```

Focused Phase 6:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts
```

Broad closeout:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

## References

- Reopened status: [`../status.md`](../status.md)
- Follow-up phase index: [`../phases/README.md`](../phases/README.md)
- Original Fastify status: `docs/fastify/status.md`
- Original Phase 9 command map:
  `docs/fastify/status/phase-9-command-map.md`
