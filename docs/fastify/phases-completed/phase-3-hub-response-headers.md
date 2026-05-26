# Phase 3 Alpha - Hub Response Headers

Date: 2026-05-27

## Scope

Closed the reopened Phase 3 alpha finding where hub passthrough
responses did not use the shared proxy response-header strip policy.

## Landed Changes

- Hub passthrough now reuses `filterResponseHeaders` from the shared
  Fastify proxy helper.
- Hub responses strip the documented Phase 3 set: CSP,
  CSP-report-only, clear-site-data, cache-control, and
  content-encoding.
- Hub keeps its existing transport-specific guard for
  `content-length` and `transfer-encoding`, so Fastify/Node can manage
  the streamed outgoing response safely.
- Focused hub coverage now proves stripped headers are absent while
  allowed upstream headers still pass through.

## Verification

Passed:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/streamJobsRoutes.test.ts
pnpm api:test -- server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts
```

## Broad Closeout

Functional Phase 3 alpha work is closed. Broad verification status lives
in [`../status.md`](../status.md).
