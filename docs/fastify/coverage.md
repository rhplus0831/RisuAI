# Test Coverage

Date: 2026-05-27

## Coverage Shards

| Concern | Doc |
|---------|-----|
| `sendChat` characterization fixtures (Phases 4-5) | [`coverage/sendchat-fixtures.md`](coverage/sendchat-fixtures.md) |
| Fastify route tests (Phases 1-3, 6-9) | [`coverage/server-routes.md`](coverage/server-routes.md) |
| Per-provider generation tests (Phase 6) | [`coverage/providers.md`](coverage/providers.md) |

## Verification Commands

```bash
pnpm check          # svelte-check + tsc
pnpm test           # frontend vitest
pnpm api:test       # Fastify route suite
pnpm build          # production bundle
pnpm smoke:fastify-browser
```

## Maintenance Rules

- Every new fixture gets a row in `coverage/sendchat-fixtures.md`.
- Every new server route gets a row in `coverage/server-routes.md`.
- Every new provider gets a row in `coverage/providers.md`.
- Coverage rows are not deleted when work lands.
