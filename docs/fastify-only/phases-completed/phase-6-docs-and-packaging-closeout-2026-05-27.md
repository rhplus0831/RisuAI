# Phase 6: Docs And Packaging Closeout

Status: Completed on 2026-05-27.

## Goal

Align docs, packaging, and public instructions with the Fastify-only runtime.

## Result

Phase 6 is complete. Public setup docs now describe Risuai as a Fastify-served web application, the README development path uses the retained Fastify scripts, Docker access points to port `6002`, and localized local-network guidance names the retained `/api/v1/proxy/*` routes instead of removed legacy proxy endpoints.

## Scope

- Update `README.md` so it no longer describes a cross-platform app.
- Update localized user-facing strings that mention Node self-hosting, Tauri, `__NODE__`, `/proxy2`, or other removed runtime details.
- Fix Docker and compose port references so they match the Fastify runtime.
- Update development instructions to use `pnpm api:dev`, `pnpm api:start`, and Fastify smoke commands.
- Remove references to removed platforms from docs and scripts.
- Update this plan folder with actual implementation results.

## Boundaries

- Do not document removed platforms as unofficial modes.
- Do not keep stale setup instructions for compatibility.
- Keep development instructions concise and Fastify-centered.

## Exit Criteria

- README, Docker, compose, and smoke docs agree on ports and startup.
- Localized app strings describe only the retained Fastify-backed runtime.
- User-facing docs mention Fastify as the only supported runtime.
- Completed implementation phases have status moved to [../phases-completed](../phases-completed/).

## Changed Files

- `README.md`
- `src/lang/en.ts`
- `src/lang/zh-Hant.ts`
- `docs/fastify-only/README.md`
- `docs/fastify-only/plan.md`
- `docs/fastify-only/runtime-stages.md`
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/status/server.md`
- `docs/fastify-only/phases/README.md`
- `docs/fastify-only/phases-completed/README.md`
- `docs/fastify-only/phases-completed/phase-6-docs-and-packaging-closeout-2026-05-27.md`

## Implementation Notes

- Reworded the README introduction from cross-platform app language to the retained Fastify-served web application shape.
- Updated README development instructions to run `pnpm api:dev` and `pnpm dev` together, with Vite proxying `/api/*` to Fastify on `http://localhost:6002`.
- Added README production startup and smoke commands: `pnpm build`, `pnpm api:start`, and `pnpm smoke:fastify-browser`.
- Aligned Docker README text with the existing `Dockerfile` and `docker-compose.yml` port `6002` contract.
- Updated English and Traditional Chinese local-network help strings so they describe Fastify `/api/v1/proxy/stream-jobs` and `/api/v1/proxy/fetch` only.
- Archived this phase and advanced the active pickup to Phase 7 verification closeout.

## Verification

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Follow-Up

- Continue with [Phase 7: Verification Closeout](../phases/phase-7-verification-closeout.md).
- Run the full verification ladder: `pnpm check`, `pnpm test`, `pnpm api:test`, `pnpm build`, and `pnpm smoke:fastify-browser`.
- Confirm the active docs and entry points remain Fastify-only before marking the overall plan complete.

## References

- `README.md:9`
- `src/lang/en.ts:154`
- `src/lang/zh-Hant.ts:247`
- `Dockerfile:38`
- `docker-compose.yml:8`
- `vite.config.ts:28`
