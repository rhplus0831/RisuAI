# Phase 3 Follow-Up - Proxy Migration

Date: 2026-05-26

Status: reopened by audit.

## Goal

Make stream-job proxy header filtering match the direct Fastify proxy
path.

## Audit Finding

The direct proxy strips response headers via
`server/fastify/src/proxy.ts:89`, with the strip set at
`server/fastify/src/proxy.ts:11`. The stream-job path has a separate
filter at `server/fastify/src/streamJobs.ts:124` and forwards upstream headers at
`server/fastify/src/streamJobs.ts:311`. The sets are not aligned, so
stream-job responses can preserve headers the direct proxy removes.

## Tasks

- Share a common response-header filter between direct proxy and
  stream-job proxy paths, or explicitly keep two sets with tests that
  document the difference.
- Ensure stream-job `upstream_headers` events do not forward stale
  `cache-control`, `content-encoding`, CSP, or other hop-sensitive
  headers that the direct proxy strips.
- Add focused route or unit tests for stream-job header filtering.

## Session Slices

- 3A - Proxy response-header alignment. Extract or share the response
  header filter used by direct proxy and stream jobs, or document a
  deliberate difference in tests. Cover direct proxy behavior,
  stream-job `upstream_headers`, and the WebSocket/route event path in
  one focused session.

## Exit Criteria

- Direct proxy and stream-job proxy header behavior is intentionally
  identical, or the documented difference is covered by tests.
- Cache and content-encoding headers from upstream stream jobs cannot
  produce misleading browser behavior.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/streamJobs.test.ts
pnpm api:test -- server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/streamJobs.test.ts
```

## References

- Original phase: `docs/fastify/phases/phase-3-proxy.md`
- Direct proxy filter: `server/fastify/src/proxy.ts:89`
- Stream-job filter: `server/fastify/src/streamJobs.ts:124`
- Stream-job forwarding: `server/fastify/src/streamJobs.ts:311`
