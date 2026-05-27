# Fastify-Only Lockdown Plan

## Goal

Remove local runtime support and all non-Fastify platform support so the project has one production shape: Fastify serves the API and the built web client.

## Scope

- Remove the Hono server subtree and related package scripts.
- Remove stale native, mobile, and legacy launcher surfaces.
- Collapse runtime platform detection around the Fastify-served client.
- Remove legacy non-Fastify storage endpoints from the client storage layer.
- Route proxy and generation IO through Fastify `/api/v1/*` APIs only.
- Retire hosted platform functions and local browser persistence flows.
- Update public docs, in-app runtime strings, smoke coverage, and packaging references to match the single runtime.

## Non-Goals

- Do not preserve compatibility for Hono, Electron, Capacitor, Cloudflare Pages Functions, legacy Node server scripts, or local browser save-file mode.
- Do not add migrations solely to bridge removed non-Fastify storage paths.
- Do not rewrite generation behavior except where platform routing blocks Fastify-only cleanup.
- Do not remove the static web client; it remains the Fastify-served UI.

## Phase Summary

| Phase | Name                                                                                          | Purpose                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 0     | [Audit And Baseline](phases-completed/phase-0-audit-and-baseline-2026-05-27.md)               | Freeze the known non-Fastify surfaces and current verification baseline. Completed on 2026-05-27.              |
| 1     | [Project Surface Removal](phases-completed/phase-1-project-surface-removal-2026-05-27.md)     | Remove alternate server projects, stale scripts, launchers, and native/mobile config. Completed on 2026-05-27. |
| 2     | [Runtime Contract Collapse](phases-completed/phase-2-runtime-contract-collapse-2026-05-27.md) | Replace broad platform gates with a Fastify-served client contract. Completed on 2026-05-27.                   |
| 3     | [Storage Contract Cleanup](phases-completed/phase-3-storage-contract-cleanup-2026-05-27.md)   | Keep Fastify storage APIs only and remove local/legacy storage fallbacks. Completed on 2026-05-27.             |
| 4     | [Proxy And API Routing](phases-completed/phase-4-proxy-and-api-routing-2026-05-27.md)         | Remove hosted and legacy proxy routes so client IO targets Fastify. Completed on 2026-05-27.                   |
| 5     | [Browser Local Surface Cleanup](phases/phase-5-browser-local-surface-cleanup.md)              | Remove remaining service worker, preload, and share flows that imply standalone local support.                 |
| 6     | [Docs And Packaging Closeout](phases/phase-6-docs-and-packaging-closeout.md)                  | Align README, localized app strings, Docker, env docs, and smoke instructions with Fastify only.               |
| 7     | [Verification Closeout](phases/phase-7-verification-closeout.md)                              | Run the full verification ladder and archive completed status.                                                 |

## Risks

- Platform gates are shared across UI, storage, proxy, and bootstrap code; removing one branch can expose stale assumptions in another.
- Storage cleanup can delete useful browser fallback behavior if the Fastify bootstrap path is not clearly separated first.
- Proxy cleanup changes security boundaries around local-network access and provider calls.
- Documentation currently uses cross-platform language, so code changes can land while user-facing instructions still point at removed modes.

## Verification

Each implementation phase should record its actual command output in the matching phase file before closeout.

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## References

- `package.json:9`
- `docs/fastify-only/phases-completed/phase-1-project-surface-removal-2026-05-27.md:1`
- `src/ts/platform.ts:13`
- `server/fastify/src/app.ts:176`
- `src/ts/storage/nodeStorage.ts:6`
- `src/ts/storage/autoStorage.ts:28`
- `src/ts/bootstrap.ts:137`
- `src/ts/browserLocalSurface.test.ts:1`
- `public/manifest.json:33`
- `src/ts/globalApi.svelte.ts:560`
- `src/ts/globalApi.proxy.test.ts:80`
- `vite.config.ts:28`
- `Dockerfile:38`
- `docker-compose.yml:8`
- `README.md:9`
- `src/lang/en.ts:154`
- `src/lang/zh-Hant.ts:247`
