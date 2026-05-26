# Phase 3 Alpha Follow-Up - Proxy Migration

Date: 2026-05-27

Status: reopened by alpha audit.

## Goal

Make every Phase 3 proxy-style path use an intentional response-header
policy. Direct proxy, stream-job proxy metadata, and hub passthrough
must either share the same strip set or document and test any deliberate
difference.

## Audit Finding

The previous follow-up aligned stream-job `upstream_headers` with the
direct proxy filter, but hub passthrough remains separate.

- Shared direct proxy strip set:
  `server/fastify/src/proxy.ts:11`
- Shared direct proxy helper:
  `server/fastify/src/proxy.ts:89`
- Stream-job `upstream_headers` now use the helper:
  `server/fastify/src/streamJobs.ts:293`
- Hub passthrough only strips `content-encoding`, `content-length`, and
  `transfer-encoding`:
  `server/fastify/src/routes/hub.ts:16`
- Hub forwards all other upstream response headers:
  `server/fastify/src/routes/hub.ts:75`

The original Phase 3 docs include `ANY /api/v1/hub/*` in the proxy
surface and describe stripping upstream CSP, CSP-report-only,
clear-site-data, cache-control, and content-encoding headers.

## Tasks

- Reuse the shared `filterResponseHeaders` helper for hub responses, or
  document why hub needs a different response-header policy.
- Add focused hub tests proving CSP, CSP-report-only, clear-site-data,
  cache-control, and content-encoding are stripped when intended.
- Keep existing hub passthrough behavior for allowed upstream headers
  covered by tests.

## Exit Criteria

- Hub response headers cannot forward the stripped Phase 3 header set
  unless the phase doc explicitly records an intentional exception.
- Direct proxy, stream-job metadata, and hub response behavior are
  covered by focused tests.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts server/fastify/__tests__/streamJobsRoutes.test.ts
pnpm api:test -- server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts
```

## References

- Original phase: `docs/fastify/phases/phase-3-proxy.md`
- Completed follow-up: `docs/fastify-followup/phases/phase-3-proxy-followup.md`
