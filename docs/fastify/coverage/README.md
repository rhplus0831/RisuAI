# Test Coverage Shards

Date: 2026-05-26

Each shard is a list of what is pinned + a brief explanation of
how to read or extend the tests. Phase 1, Phase 2, and Phase 3
Fastify route tests exist, the Phase 4 `sendChat`
characterization fixtures have landed, and Phase 5 helper tests now
cover extracted browser-side seams. Phase 6 route and provider
tests cover the current `/api/v1/generate/completion` slices.
Phase 7 now has `/chat` and `/preview-prompt` route tests, prompt
leaf tests, token/preflight/budget/trigger tests, template renderer
tests, assembler tests, and browser `/chat` adapter + preview wiring
tests. Phase 8 now has memory job/read route coverage, focused memory
service tests, browser memory adapter tests, and server-backed
`hypav3-memory` fixture parity. Phase 9 coverage now spans command
routes through the 9-4 resource families, 9-5 projection events /
bootstrap / guard behavior, 9-6 storage and provider-secret gates, and
9-7/9-8 server `.risu` codec, import, export, asset-report, and bundle
tests.

## Shards

- [`sendchat-fixtures.md`](sendchat-fixtures.md) - local and
  server-backed `sendChat` characterization fixtures.
- [`server-routes.md`](server-routes.md) - Phase 1-3 + 6-9 route
  tests.
- [`providers.md`](providers.md) - per-provider tests for
  `/api/v1/generate/completion`.

## Conventions

- One line per pinned behavior. Keep the description short
  enough to scan.
- Use `path:line` references to point to the test that pins the
  behavior.
- A pinned behavior is one that should not regress; tests that
  are scaffolding (e.g. fixture loaders) do not belong here.
