# Test Coverage Shards

Date: 2026-05-20

Each shard is a list of what is pinned + a brief explanation of
how to read or extend the tests. None of these tests exist yet on
the `fastify` branch; this directory is the planning artifact.

## Shards

- [`sendchat-fixtures.md`](sendchat-fixtures.md) - Phase 4 + 5
  characterization fixtures.
- [`server-routes.md`](server-routes.md) - Phase 1-3 + 6-8 route
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
