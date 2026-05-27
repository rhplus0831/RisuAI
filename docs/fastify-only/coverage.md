# Fastify-Only Coverage

## Coverage Shards

- [Server Routes](coverage/server-routes.md) tracks Fastify route coverage and legacy route removals.
- [Providers](coverage/providers.md) tracks proxy and provider routing expectations.
- [SendChat Fixtures](coverage/sendchat-fixtures.md) tracks generation fixture expectations that must survive platform cleanup.

## Required Commands

Use the full ladder when implementation changes cross platform, storage, proxy, or bootstrap boundaries:

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## Focus Areas

- Route tests should prove the `/api/v1/*` contract and fail if legacy paths are still required.
- Client tests should cover Fastify bootstrap without local save-file fallbacks.
- Smoke tests should prove the built client and Fastify server agree on ports, static root, and API base paths.
- Provider tests should prove no hosted function or legacy proxy branch is selected.

## Maintenance Rules

- Add coverage before deleting platform branches that currently mask behavior.
- Record intentionally removed behavior in [removed-and-out-of-scope.md](removed-and-out-of-scope.md), not in skipped tests.
- Keep fixture updates minimal unless the runtime contract genuinely changes expected output.
