# Next Steps

Date: 2026-06-05

All scheduled work is complete. The plan is now in maintenance mode.

## Current Posture

1. Keep the Phase 8 gate green:
   `src/ts/__tests__/fixCompletenessGate.test.ts`.
2. If L4, L7, L26, or U2 gets real-corpus evidence or owner approval, schedule
   it with the same path: slice doc, fix, regression, gate flip, verification
   log update.
3. After any change to a narrowed or bounded path, rerun the relevant proof
   command below and refresh [`latest-verification.md`](latest-verification.md).

## Completed Batches

| Phase | IDs | Commit / note |
| --- | --- | --- |
| 1 | H1, H2, H3 | `0dc7452e`, `067ab82a`, `e41dc6c6` |
| 2 | M1, M3, M4, M5, L1, L2, L5, L6, L10, U1 | `c193c008`, `e0e86ab1`, `254b3112`, `b2765994` |
| 3 | M12-M14, L31-L36, U4 | `0efa7ba6` plus L32 watcher/global-modal follow-up |
| 4 | M6, M8, L20, L22-L25 | `bf1a6cb2` |
| 5 | M9-M11, L11-L15, L27-L30 | `686220d6` |
| 6 | M7, L16-L19, L21 | `ca798c01` |
| 7 | M2, L3, L8, L9, L37-L40 | `151c6978` |
| 8 | all scheduled IDs | Closing full run recorded; gate stays live |

The final proof set was: `pnpm test` 1132/4, `pnpm api:test` 1737/1,
`pnpm client-thinning:audit` green, and both TypeScript checks with zero errors.

## Guardrails

- Do not edit `loadPersistedWithMessages` as a hot-path shortcut. Add a scoped
  loader for the specific path.
- Keep `currentChatStateSnapshot` and the broad SQLite loaders for
  create/delete/reorder/fork and true full-corpus consumers.
- A narrowed rollback restores only the fields its command mutates.
- Use the durable path's 600s timeout as the provider/proxy reference.
- Memory and Lua budgets bound work, not output. Do not change memory selection
  output or `/generate/chat` SSE vocabulary.
- Do not change `.risu` envelope bytes or projection/bootstrap payloads unless
  round-trip and payload tests prove identity.
- Memoization must keep output bytes identical. Keep M2/L3/L40 tests passing.
- Do not schedule L4, L7, L26, or U2 without evidence or owner approval.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
load, projection, guard, or lifecycle behavior. `pnpm api:test -- <file>` does
not filter; use Vitest directly for focused server runs.

Server focused runs:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/projection.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/scripts.test.ts \
  server/fastify/__tests__/lorebook.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/events.test.ts \
  server/fastify/__tests__/repositoryWriterKit.test.ts \
  server/fastify/__tests__/commandFloorUnblock.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMetrics.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/proxy.test.ts \
  server/fastify/__tests__/generation.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts
```

Client focused runs:

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts
pnpm exec vitest run \
  src/ts/process/triggers.regexMemo.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/process/serverBackedSendChat.findMessage.test.ts \
  src/ts/process/__tests__/command.projectionGuard.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts
```

Full proof set:

```bash
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
