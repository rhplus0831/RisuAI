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

1. Phase 6 streaming errors are closed again.
   - 6A: landed streaming error frame contract plus OpenAI-compatible
     failure handling.
   - 6B: landed Anthropic, Mistral, and Gemini stream failure alignment.
   - 6C: landed Ollama stream failure alignment and final provider audit.

2. Phase 0 removals are closed again.
   - 0A: landed Google Drive public artifact removal.

3. Phase 3 proxy cleanup is the next default pickup.
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

Phase 8 memory follow-up closed in slices 8A-8C.

- 8A: stable custom embedding job model key and custom wire-model
  routing.
- 8B: production memory progress events over `/api/v1/events`, parsed by
  the browser event subscriber and applied to the Hypa V3 progress store.
- 8C: missing-summary diagnostics now include chunks with neither
  summary nor embedding, so prompt follow-ups schedule summarize jobs for
  those chunks.

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
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts
pnpm test -- src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts
```

Focused Phase 6:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/ollama.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts
```

Focused Phase 0:

```bash
rg -n "functions/drive|/drive(?:\\.|$)|drive\\.js|CLIENT_SECRET|CLIENT_ID|Google Drive sync|savebackup|loadbackup" public src server --glob '!public/token/**' --glob '!src/lang/**'
rg -n "CLIENT_SECRET|CLIENT_ID|functions/drive|drive\\.js" dist public src server --glob '!public/token/**'
pnpm build
```

Focused Phase 3:

```bash
pnpm api:test -- server/fastify/__tests__/proxy.test.ts
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
