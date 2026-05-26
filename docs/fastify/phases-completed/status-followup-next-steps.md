# Next Steps

Date: 2026-05-27

Use this file as the closed first-audit runbook. The phase files under
`../phases/` hold source evidence and exit criteria for that audit; the
current next-steps runbook lives in
[`../status/next-steps.md`](../status/next-steps.md).

Policy note: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly rather than preserving intermediate
Fastify shapes.

## Immediate Pickup

For any future reopened first-audit work, pick one slice per session.
Each slice should leave the worktree in a reviewable state with focused
tests, update the affected phase file, and add any longer closeout note
under `../phases-completed/`.

No immediate pickup remains from the first audit. The alpha broad
typecheck cleanup is also closed, so new work should start only from a
fresh recorded finding.

## Recently Closed

| Phase | Closed Slice(s) | Closeout                                                                 |
| ----- | --------------- | ------------------------------------------------------------------------ |
| 0     | 0A              | Removed the tracked Google Drive public worker artifact.                 |
| 3     | 3A              | Stream-job `upstream_headers` use the direct proxy response-header filter. |
| 6     | 6A-6C           | OpenAI-compatible, Anthropic, Mistral, Gemini, and Ollama stream failures emit typed error frames. |
| 7     | 7A-7E           | Regenerate, provider guards, stop-trigger payloads, and route-backed fixture coverage are closed. |
| 8     | 8A-8C           | Custom embeddings, memory progress events, and missing-summary diagnostics are closed. |
| 9     | Guard/import + 9A-9J | Direct-write follow-up closed; the final sweep is anchored at `67a9dab4`. |

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
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/streamJobs.test.ts server/fastify/__tests__/streamJobsRoutes.test.ts
pnpm api:test -- server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/streamJobs.test.ts
```

Broad closeout:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

## References

- Follow-up status: [`status-followup-closeout.md`](status-followup-closeout.md)
- Phase index: [`../phases/README.md`](../phases/README.md)
- Current live status: [`../status.md`](../status.md)
- Phase 9 command map:
  [`../status/phase-9-command-map.md`](../status/phase-9-command-map.md)
