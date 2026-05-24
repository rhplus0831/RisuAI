# Phase 8 Memory - 8-2a Closeout

Date: 2026-05-24

## Scope Landed

- Added explicit memory job queue primitives in
  `server/fastify/src/memoryRepository.ts`:
  `enqueueMemoryJob`, `claimNextMemoryJob`, `completeMemoryJob`,
  `failMemoryJob`, and `cancelMemoryJob`.
- `claimNextMemoryJob` atomically moves the oldest matching pending job
  to running, ordered by `created_at, id`, and supports optional `chatId`
  and `kind` filters.
- `listMemoryJobs` now supports a multi-status filter while preserving
  the existing single-status, chat, and kind filters.
- Legal transitions are enforced:
  - `pending -> running` via claim.
  - `running -> completed` via complete.
  - `running -> failed` via fail.
  - `pending | running -> cancelled` via cancel.
  - `completed`, `failed`, and `cancelled` remain terminal.
- Illegal transition attempts return `null`; malformed ids, payloads,
  status filters, and empty failure errors raise `ValidationError`.
- Repository tests cover enqueue validation, deterministic claim order,
  status filtering, legal transitions, illegal transitions, terminal
  state protection, and missing job behavior.

## Boundaries

- Jobs remain inert data rows.
- No timers, polling loop, worker lifecycle, retry/backoff scheduling,
  boot recovery, SSE progress events, routes, provider calls, real memory
  mutation handlers, or browser UI.
- `updateMemoryJob` remains available as the low-level row patch helper
  from 8-1b; new worker and route code should prefer the state-machine
  primitives for queue transitions.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryRepository.test.ts --config server/fastify/vitest.config.ts
pnpm exec vitest run server/fastify/__tests__/memoryRepository.test.ts server/fastify/__tests__/memoryLegacyImport.test.ts server/fastify/__tests__/db.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 914 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-2b - worker lifecycle + stub dispatch. Add the single
in-process memory worker, Fastify startup/shutdown integration, polling,
one-at-a-time job claiming, and kind-based dispatch to no-op `chunk`,
`embed`, and `summarize` handlers. Keep retry/backoff, boot recovery,
SSE progress, routes, provider calls, real memory mutation handlers, and
browser UI out of 8-2b.
