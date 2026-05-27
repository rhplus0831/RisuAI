# Fastify-Only Next Steps

## Current Pickup

Start with [Phase 2: Runtime Contract Collapse](../phases/phase-2-runtime-contract-collapse.md). Phase 0 and Phase 1 are closed in [phases-completed](../phases-completed/).

## Immediate Tasks

1. Collapse `src/ts/platform.ts` around the Fastify-served runtime.
2. Remove `globalThis.__NODE__` from Fastify static serving and keep one clear Fastify/server-backed bootstrap signal.
3. Update tests that mock platform state so they describe the retained Fastify contract.
4. Leave storage endpoint cleanup, proxy routing cleanup, service worker cleanup, and localized runtime strings to their later phases unless Phase 2 directly exposes a dead branch.
5. Update this file after Phase 2 closes.

## Phase 2 Verification To Record

- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## Watch Points

- Phase 1 removed project-level Hono, launcher, and native/mobile surfaces; do not resurrect them while collapsing runtime gates.
- Keep Phase 2 focused on shared platform/bootstrap signals.
- Include localized app strings in the docs and packaging closeout, not only markdown files.
- Treat newly discovered project-level non-Fastify surfaces as follow-up findings, but defer storage and proxy contract changes to later phases.
