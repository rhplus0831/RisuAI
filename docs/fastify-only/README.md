# Fastify-Only Plan

This folder is the planning workspace for removing local runtime support and all non-Fastify platform support. It follows the structure of `docs/fastify` while keeping the contents focused on the Fastify-only lock-down effort.

## Current State

- Draft created on 2026-05-27.
- Phase 0 audit and baseline closed on 2026-05-27.
- Phase 1 project surface removal closed on 2026-05-27.
- Phase 2 runtime contract collapse closed on 2026-05-27.
- Phase 3 storage contract cleanup closed on 2026-05-27.
- Fastify is the only target production runtime.
- The client remains a static web client served by Fastify; legacy hosted functions and browser-local support surfaces remain removal candidates.
- The existing Fastify migration docs already describe server-backed web as the supported shape, but several compatibility bridges remain in storage, proxy routing, service worker behavior, and public docs.

## Read Order

1. [plan.md](plan.md) for scope, phases, risks, and verification.
2. [status.md](status.md) for current phase state and closeout rules.
3. [architecture.md](architecture.md) for the target Fastify-only runtime contract.
4. [runtime-stages.md](runtime-stages.md) for the order in which runtime surfaces collapse.
5. [coverage.md](coverage.md) and the [coverage](coverage/) shards for test expectations.
6. [removed-and-out-of-scope.md](removed-and-out-of-scope.md) for removals and permanent non-goals.
7. [design](design/) for locked decisions.
8. [phases](phases/) for active phase plans and [phases-completed](phases-completed/) for closed work.
9. [status](status/) for present-tense pickup notes.

## Locked Decisions

- Fastify is the only supported runtime and deployment target.
- Non-Fastify server projects, native wrappers, local-only browser persistence, legacy node endpoints, and platform launchers should be removed rather than kept behind compatibility shims.
- There are no real Fastify users to migrate yet, so schemas, storage contracts, imports, and paths may be changed directly as long as the Fastify target remains internally consistent.
- Development conveniences are allowed only when they exercise the Fastify runtime, such as Vite proxying API calls to the Fastify server.
- Historical compatibility behavior belongs in `phases-completed` only after it has been closed; active status docs should describe the present state.

## Conventions

- Use absolute dates such as `2026-05-27`.
- Cite source locations as `path:line`.
- Keep status shards present-tense.
- Keep verification commands explicit: `pnpm check`, `pnpm test`, `pnpm api:test`, `pnpm build`, and `pnpm smoke:fastify-browser`.
- Prefer removal over abstraction when code exists only to support local or non-Fastify platforms.
