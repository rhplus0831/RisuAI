# Test Coverage

Date: 2026-05-27

## Coverage Shards

| Concern | Doc |
|---------|-----|
| `sendChat` characterization fixtures (Phases 4-5) | [`coverage-records/sendchat-fixtures.md`](coverage-records/sendchat-fixtures.md) |
| Fastify route tests (Phases 1-3, 6-9) | [`coverage-records/server-routes.md`](coverage-records/server-routes.md) |
| Per-provider generation tests (Phase 6) | [`coverage-records/providers.md`](coverage-records/providers.md) |

## Verification Commands

```bash
pnpm check          # svelte-check + tsc
pnpm test           # frontend vitest
pnpm api:test       # Fastify route suite
pnpm build          # production bundle
pnpm smoke:fastify-browser
```

## Maintenance Rules

- Every new fixture gets a row in `coverage-records/sendchat-fixtures.md`.
- Every new server route gets a row in `coverage-records/server-routes.md`.
- Every new provider gets a row in `coverage-records/providers.md`.
- Coverage rows are not deleted when work lands.
