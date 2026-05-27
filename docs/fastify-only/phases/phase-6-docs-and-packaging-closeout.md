# Phase 6: Docs And Packaging Closeout

## Goal

Align docs, packaging, and public instructions with the Fastify-only runtime.

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

## Verification

- `pnpm check`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## References

- `README.md:9`
- `src/lang/en.ts:154`
- `src/lang/zh-Hant.ts:247`
- `Dockerfile:38`
- `docker-compose.yml:8`
- `vite.config.ts:28`
