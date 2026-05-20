# Test Coverage

Date: 2026-05-20

This is the coverage router. Detail per area lives in the
shards under [`coverage/`](coverage/).

## Snapshot

- No characterization tests for `sendChat` exist yet.
- Existing tests cover helper surfaces only, not the generation
  pipeline. Relevant current files include
  `src/ts/process/ttsHooks.test.ts`,
  `src/ts/process/request/tests/additionalParams.test.ts`,
  `src/ts/process/mcp/risuaccess/tests/modules.test.ts`, and
  `src/ts/process/files/tests/inlays.test.ts`; broader repo tests
  cover parser, media, translator, network, and source-map helpers.
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
pnpm build          # production bundle
```

Run these before closing a browser-only slice. Add `pnpm api:test`
to the required set once Phase 1 creates the Fastify server tests.

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
