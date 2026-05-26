# Phase 3 Slice 3A - Proxy Response-Header Alignment

Date: 2026-05-27

## Summary

- Reused the direct proxy `filterResponseHeaders` helper for stream-job
  upstream header events.
- Removed the separate stream-job response-header strip set so direct
  proxy and stream-job proxy behavior cannot drift independently.
- Expanded stream-job unit coverage for `cache-control`,
  `content-encoding`, CSP, report-only CSP, and `clear-site-data`.
- Expanded WebSocket route coverage so filtered `upstream_headers`
  events are verified through the real route path.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/streamJobs.test.ts server/fastify/__tests__/streamJobsRoutes.test.ts
pnpm api:test -- server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/streamJobs.test.ts
```

## Follow-Up

- Phase 3 is closed again.
- No immediate pickup remains from the first follow-up audit. The alpha
  audit is also closed in the alpha audit phases.
