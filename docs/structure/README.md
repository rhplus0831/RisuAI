# Structure Documentation Index

Last audited: 2026-07-20.

Read [`STRUCTURE.md`](../../STRUCTURE.md) for the repository boundary and stable
conventions. Then open only the document that owns the behavior you are
changing. These notes describe current code; dated investigations and completed
plans belong in [`.archived-docs/`](../../.archived-docs/README.md).

## Ownership

| Document                                                             | Owns                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [`backend.md`](backend.md)                                           | Fastify composition, security hooks, route families, command registration, generation jobs, and worker wiring                  |
| [`data-and-events.md`](data-and-events.md)                           | SQLite stores, revisions, lineage, active writer, command events, SSE, and server-owned write exceptions                       |
| [`server-resources-and-bridges.md`](server-resources-and-bridges.md) | Browser root resources, inlay-catalog projection, hydration, durable mutation replay, invalidation, and settings/data bridges  |
| [`assets-and-saves.md`](assets-and-saves.md)                         | Content-addressed assets, inlay-catalog persistence/GC, `.risu` formats, imports/exports, Realm conversion, and backup/restore |
| [`plugins-and-mcp.md`](plugins-and-mcp.md)                           | Plugin host, permissions, storage/network boundaries, modules, MCP transports, and import/lifecycle boundaries                 |
| [`providers-and-models.md`](providers-and-models.md)                 | Model profiles, capabilities, prompt assembly, provider dispatch, tools, and fixed provider/media operations                   |
| [`testing-and-operations.md`](testing-and-operations.md)             | pnpm scripts, test lanes, local dev, environment, CI, tracing, and TypeScript                                          |
| [`domain-glossary.md`](domain-glossary.md)                           | Shared record names, mutation terms, runtime boundaries, and no-port concepts                                                  |
| [`generated-and-legacy.md`](generated-and-legacy.md)                 | Generated, vendored, ignored, compatibility-only, retired-setting, and deliberately absent surfaces                            |
| [`frontend.md`](frontend.md)                                         | Compatibility pointer to the current [`src/docs/`](../../src/docs/README.md) UI/client guides                                  |

## Cross-Cutting Changes

| If you change...                      | Also inspect...                                                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A route or auth/writer classification | `server/fastify/src/app.ts`, `server/fastify/src/routeManifest.ts`, `server/fastify/src/routeRateLimits.ts`, `server/fastify/__tests__/routeProtection.test.ts`, and [`backend.md`](backend.md) |
| A revisioned command                  | Browser command/outbox semantic keys, server receipt behavior, invalidation/local-effect handling, [resource state](server-resources-and-bridges.md), and [data/events](data-and-events.md)     |
| A persisted setting                   | Server defaults and group ownership, browser group ownership, parity tests, [setting UI](../../src/docs/svelte-ui.md#settings-and-shared-controls), and `src/lang/`                             |
| An asset or inlay-catalog field       | Asset metadata/GC/backup ownership in [`assets-and-saves.md`](assets-and-saves.md), catalog commands/events, the full-refresh resource set, and the inlay explorer UI                           |
| A model/provider capability           | Shared capability metadata, server assembly/dispatch, browser profile UI, provider tests, and [`providers-and-models.md`](providers-and-models.md)                                              |
| A module/MCP behavior                 | Import validation, command restrictions, runtime transport, plugin permissions, and [`plugins-and-mcp.md`](plugins-and-mcp.md)                                                                  |
| An import/export or restore format    | Lineage/revision effects, asset reporting, bounded decoding, fixtures, and [`assets-and-saves.md`](assets-and-saves.md)                                                                         |
| User-visible behavior                 | [`src/docs/svelte-ui.md`](../../src/docs/svelte-ui.md), relevant visible-state tests, and language keys                                                                                         |

## Maintenance Rules

- Keep stable orientation in `STRUCTURE.md`; keep implementation detail in the
  nearest focused document.
- Prefer literal source paths and name the test or protocol constant that makes
  a claim durable. Do not copy large endpoint inventories that can be obtained
  from `app.printRoutes()`.
- Link to the canonical owner instead of repeating a contract across documents.
- Move branch reviews, audits, plans, and closeout reports into the matching
  `.archived-docs/` topic and add them to that topic's index.
- Update an audit date only after checking the document against current code.
