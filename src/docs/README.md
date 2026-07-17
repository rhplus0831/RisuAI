# Source Docs

Last audited: 2026-07-17.

These notes are the current frontend/client documentation for agents working in
`src/`. They replace the old compact frontend map under `docs/structure/`.

| File                         | Use                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`svelte-ui.md`](svelte-ui.md)           | First stop for Svelte UI/UX work: app shell, routes/history, settings, shared controls, chat, sidebar, modals, accessibility, mobile/lite, playground, styling, and visible-state tests.                                                                  |
| [`client-runtime.md`](client-runtime.md) | Browser runtime touchpoints that shape visible UI: Fastify bootstrap and hydration, encrypted crash-durable mutation replay, command reconciliation, generation and progress streams, provider/media operation adapters, module import/assets, storage, plugins, and MCP. |

Continue with the canonical focused notes instead of copying their contracts
into frontend guides:

| Topic | Canonical guide |
| ----- | --------------- |
| Resource protocol, hydration, and command reconciliation | [`server-resources-and-bridges.md`](../../docs/structure/server-resources-and-bridges.md) |
| Prompt assembly, model profiles, providers, and Agent Presets | [`providers-and-models.md`](../../docs/structure/providers-and-models.md) |
| Plugin storage/execution and MCP boundaries | [`plugins-and-mcp.md`](../../docs/structure/plugins-and-mcp.md) |
| Scripts, Vite, test lanes, dev server, and operations | [`testing-and-operations.md`](../../docs/structure/testing-and-operations.md) |
