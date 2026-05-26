# Next Steps

Date: 2026-05-27

Use this file as the closed alpha runbook. The source of truth for
current state is [`../status.md`](../status.md); create a new focused
phase file under `../phases/` only after a new audit finding is
recorded.

Policy note: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly rather than preserving intermediate
Fastify shapes.

## Immediate Pickup

One open finding from the 2026-05-27 Phases 0-9 audit: trigger
collection/chat data effects (`globalLore`, chat `note`) in
`src/ts/process/triggers.ts` still write `DBState.db` directly and throw
under the server-backed projection guard. Scope and prescribed routing are
in [`../phases/phase-9-trigger-projection-writes.md`](../phases/phase-9-trigger-projection-writes.md).

The scalar trigger / scripting / UI projection writes from the same audit,
the broad typecheck blocker, and the `LEFTOVER.md` Phase 3 / Phase 7 /
Phase 9 pickup are closed; the full broad matrix passed on 2026-05-27.

For future work, pick one focused slice per work session only after a
new finding is recorded. Each slice should leave the worktree in a
reviewable state with focused tests, an updated live status, and any
longer closeout note under `../phases-completed/`.

## Closed Alpha Slices

| Slice                              | Anchor     | Closeout                                                                                                                             |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Scalar trigger/scripting/UI writes | pending    | [`../phases-completed/phase-9-trigger-scalar-projection-writes.md`](../phases-completed/phase-9-trigger-scalar-projection-writes.md) |
| Leftover audit closeout            | pending    | [`../phases-completed/leftover-audit-closeout.md`](../phases-completed/leftover-audit-closeout.md)                                   |
| Broad closeout typecheck cleanup   | `50d55b97` | [`../phases-completed/broad-closeout-typecheck-alpha.md`](../phases-completed/broad-closeout-typecheck-alpha.md)                     |
| Phase 5 sendChat boundary cleanup  | `bd7a4712` | [`../phases-completed/phase-5-sendchat-boundary-alpha.md`](../phases-completed/phase-5-sendchat-boundary-alpha.md)                   |
| Phase 9B projection-write tails    | `cf830b9e` | [`../phases-completed/phase-9-projection-write-tails-9b.md`](../phases-completed/phase-9-projection-write-tails-9b.md)               |
| Phase 6 SSE line endings           | `0c429fe8` | [`../phases-completed/phase-6-sse-line-endings.md`](../phases-completed/phase-6-sse-line-endings.md)                                 |
| Phase 6 truncated SSE tails        | `d570f482` | [`../phases-completed/phase-6-generation-sse-tails.md`](../phases-completed/phase-6-generation-sse-tails.md)                         |
| Phase 3 hub response headers       | `0cee686d` | [`../phases-completed/phase-3-hub-response-headers.md`](../phases-completed/phase-3-hub-response-headers.md)                         |
| Phase 8 memory event isolation     | `ed4d53a8` | [`../phases-completed/phase-8-memory-event-isolation.md`](../phases-completed/phase-8-memory-event-isolation.md)                     |
| Phase 9A projection-write blockers | `7bc0e8f6` | [`../phases-completed/phase-9-client-thinning-9a.md`](../phases-completed/phase-9-client-thinning-9a.md)                             |

## Latest Broad Verification

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Results from 2026-05-27:

- `pnpm check` passed: 0 errors, 0 warnings.
- `pnpm test` passed: 69 files, 747 passed, 4 skipped.
- `pnpm api:test` passed: 68 files, 1217 passed.
- `pnpm build` passed with nonblocking build warnings.
- `pnpm smoke:fastify-browser` passed: 1 browser smoke test.

## Focused Regression Commands

Phase 6 SSE handling:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/anthropic.test.ts server/fastify/__tests__/mistral.test.ts server/fastify/__tests__/gemini.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

Phase 5 sendChat boundary:

```bash
pnpm exec vitest run src/ts/process/__tests__
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
pnpm check
```

Phase 3 proxy and hub headers:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts
pnpm api:test -- server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts
```

Phase 8 memory events:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/events.test.ts
pnpm test -- src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts
```

Phase 9 projection-write tails:

```bash
rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/moduleCommands.test.ts src/ts/characterCommands.test.ts src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts src/ts/characters.importChat.test.ts src/ts/process/modules.test.ts src/ts/process/mcp/risuaccess/tests/modules.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
```

## References

- Current status: [`../status.md`](../status.md)
- Phase index: [`../phases/README.md`](../phases/README.md)
- Phase 9 command map: [`phase-9-command-map.md`](phase-9-command-map.md)
- Migration closeout: [`../phases-completed/status-migration-closeout.md`](../phases-completed/status-migration-closeout.md)
- First-audit closeout: [`../phases-completed/status-followup-closeout.md`](../phases-completed/status-followup-closeout.md)
