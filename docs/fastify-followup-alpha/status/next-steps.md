# Next Steps

Date: 2026-05-27

Use this file as the pickup runbook for the reopened alpha audit work.
The phase files under `../phases/` hold source evidence and exit
criteria.

Policy note: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly rather than preserving intermediate
Fastify shapes.

## Immediate Pickup

Pick one slice per work session. Each slice should leave the worktree in
a reviewable state with focused tests, update the affected phase file,
and add any longer closeout note under `../phases-completed/`.

Recommended order:

1. Phase 9 - projection-write blockers in module settings, side chat
   list, toggles, and lorebook page selection.
2. Phase 6 - unterminated provider SSE tails must emit typed provider
   errors instead of `done`.
3. Phase 3 - hub passthrough response-header filtering should match the
   shared direct proxy strip set.
4. Phase 8 - memory event sinks and subscribers must not be able to
   abort committed memory jobs/routes.

## Focused Verification

Phase 3:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts
pnpm api:test -- server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts
```

Phase 6:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/anthropic.test.ts server/fastify/__tests__/mistral.test.ts server/fastify/__tests__/gemini.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

Phase 8:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/events.test.ts
pnpm test -- src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts
```

Phase 9:

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/moduleCommands.test.ts src/ts/characterCommands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
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
