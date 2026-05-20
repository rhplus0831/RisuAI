# Test Coverage

Date: 2026-05-20

This is the coverage router. Detail per area lives in the
shards under [`coverage/`](coverage/).

## Snapshot

- No characterization tests for `sendChat` exist yet.
- The existing test files in `src/ts/process/` are
  `ttsHooks.test.ts` and `sourcemap.test.ts` - small helpers,
  not the generation pipeline.
- The Fastify server does not yet exist; `pnpm api:test` is not
  a script yet.

## Where to look

| Concern                                        | Open                                                           |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `sendChat` characterization fixtures (Phase 4) | [coverage/sendchat-fixtures.md](coverage/sendchat-fixtures.md) |
| Fastify route tests (Phases 1-3, 6-8)          | [coverage/server-routes.md](coverage/server-routes.md)         |
| Per-provider generation tests (Phase 6)        | [coverage/providers.md](coverage/providers.md)                 |

## Verification commands

```bash
pnpm check          # svelte-check + tsc
pnpm test           # frontend vitest (existing)
pnpm api:test       # server vitest (Phase 1+)
pnpm build          # production bundle
```

Run all four before closing a phase slice.

## Maintenance

- Every fixture added to the sendChat suite gets a row in
  [`coverage/sendchat-fixtures.md`](coverage/sendchat-fixtures.md)
  with one line about what it pins.
- Every new server route gets a row in
  [`coverage/server-routes.md`](coverage/server-routes.md) once
  the route has a test.
- Every new provider in `/api/v1/generate/completion` gets a row
  in [`coverage/providers.md`](coverage/providers.md).
- Coverage rows are not deleted when work lands; they document
  what is pinned.
