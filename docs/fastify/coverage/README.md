# Test Coverage Shards

Date: 2026-05-23

Each shard is a list of what is pinned + a brief explanation of
how to read or extend the tests. Phase 1, Phase 2, and Phase 3
Fastify route tests exist, the Phase 4 `sendChat`
characterization fixtures have landed, and Phase 5 helper tests now
cover extracted browser-side seams. Phase 6 route and provider
tests cover the current `/api/v1/generate/completion` slices.
Phase 7 now has chat-route scaffold tests plus prompt variable,
static-section, plain-section, history, script, module-helper, and
lorebook tests; later helper routes and Phases 8-9 remain planning
artifacts until their routes land.

## Shards

- [`sendchat-fixtures.md`](sendchat-fixtures.md) - Phase 4 + 5
  characterization fixtures.
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
