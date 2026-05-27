# Phase 4: Proxy And API Routing

## Goal

Route provider and proxy IO through Fastify only.

## Scope

- Remove legacy node proxy branches from `src/ts/globalApi.svelte.ts`.
- Remove hosted hub or hosted function proxy branches that are not part of Fastify.
- Delete `public/functions/proxy.js` and `public/functions/proxy2.js` after no client code selects them.
- Update local-network restriction checks so they align with Fastify-only semantics.
- Keep provider fixture behavior stable unless the route contract intentionally changes.

## Boundaries

- Do not rewrite provider-specific prompt or response behavior as part of proxy cleanup.
- Do not keep deleted proxy paths as aliases.
- Keep security checks explicit in the Fastify route path.

## Exit Criteria

- Client proxy calls use `/api/v1/proxy/*` only.
- Hosted function proxy files are gone.
- Provider and route tests cover retained Fastify proxy behavior.

## Slice Status

### Phase 4A: Client Proxy Endpoint Collapse

Completed on 2026-05-27.

Changed files:

- `src/ts/globalApi.svelte.ts`
- `src/ts/globalApi.proxy.test.ts`
- `public/functions/proxy.js`
- `public/functions/proxy2.js`
- `docs/fastify-only/README.md`
- `docs/fastify-only/plan.md`
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/status/server.md`
- `docs/fastify-only/phases/README.md`
- `docs/fastify-only/architecture.md`
- `docs/fastify-only/coverage/providers.md`
- `docs/fastify-only/coverage/server-routes.md`
- `docs/fastify-only/removed-and-out-of-scope.md`
- `docs/fastify-only/phases-completed/phase-4-proxy-and-api-routing-2026-05-27.md`

Completed work:

- Collapsed client proxy URL builders so buffered proxy fetch, stream job creation, stream job deletion, and stream job WebSocket paths always target `/api/v1/proxy/*`.
- Removed the hosted hub fallback paths for `/proxy2` and `/proxy-stream-jobs` from client proxy selection.
- Renamed the stale `getProxy2Url()` helper to `getProxyFetchUrl()` and updated the stream fallback warning to name the retained Fastify proxy fetch.
- Added focused client tests proving buffered proxy fetches and local-network streaming jobs use Fastify endpoints and fail if legacy proxy path fragments reappear.
- Deleted the Cloudflare Pages-style hosted proxy function files.

Verification:

- `pnpm exec vitest run src/ts/globalApi.proxy.test.ts` passed: 1 file and 2 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 75 files, 770 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

Next pickup:

- Continue with [Phase 5: Browser Local Surface Cleanup](../phases/phase-5-browser-local-surface-cleanup.md).
- Keep localized runtime strings that mention `/proxy2` or removed runtime wording for Phase 6 unless Phase 5 directly touches the same UI surface.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## References

- `src/ts/globalApi.svelte.ts:560`
- `src/ts/globalApi.proxy.test.ts:80`
- `server/fastify/src/routes/proxy.ts:24`
- `server/fastify/src/routes/streamJobs.ts:99`
