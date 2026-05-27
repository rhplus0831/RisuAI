# Phase 2: Runtime Contract Collapse

## Goal

Replace broad platform detection with a Fastify-served client contract.

## Scope

- Collapse `src/ts/platform.ts` around the Fastify-only runtime.
- Remove `isTauri`, local-only, node-server, and generic web branches when they no longer describe supported behavior.
- Remove `globalThis.__NODE__` from Fastify static serving.
- Keep or rename a single Fastify/server-backed signal for client bootstrap.
- Update call sites that used platform checks for storage, proxy, bootstrap, or UI gating.

## Boundaries

- Do not preserve aliases solely to avoid updating call sites.
- Keep test harness support explicit and local to tests.
- Do not change storage endpoint behavior until Phase 3 unless needed to compile.

## Exit Criteria

- Runtime code no longer models removed platforms as supported states.
- Fastify static serving exposes one clear bootstrap signal.
- Platform-dependent call sites either use the new contract or are removed.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## References

- `src/ts/platform.ts:13`
- `server/fastify/src/app.ts:176`
- `src/ts/bootstrap.ts:137`
