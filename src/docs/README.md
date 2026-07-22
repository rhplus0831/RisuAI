# Source Docs

Last audited: 2026-07-23.

These notes are the current frontend/client documentation for agents working in
`src/`. They replace the old compact frontend map under `docs/structure/`.

| File                                     | Use                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`svelte-ui.md`](svelte-ui.md)           | First stop for Svelte UI/UX work: app shell, routes/history, settings, input hooks, Saved Toggles, popup editor, shared controls, chat/sidebar, viewport layout, mobile/lite, playground, and visible-state tests.                   |
| [`client-runtime.md`](client-runtime.md) | Browser coordination that shapes visible UI: startup, active-writer loss, root-resource ownership, durable mutations, async freshness, generation/reattach, fixed server-operation adapters, and links to adjacent canonical owners. |

Continue with the canonical focused notes instead of copying their contracts
into frontend guides:

| Topic                                                            | Canonical guide                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Resource protocol, hydration, and command reconciliation         | [`server-resources-and-bridges.md`](../../docs/structure/server-resources-and-bridges.md) |
| Assets, inlay catalog, saves, backups, Realm, and legacy storage | [`assets-and-saves.md`](../../docs/structure/assets-and-saves.md)                         |
| Prompt assembly, model profiles, providers, and Agent Presets    | [`providers-and-models.md`](../../docs/structure/providers-and-models.md)                 |
| Plugin storage/execution and MCP boundaries                      | [`plugins-and-mcp.md`](../../docs/structure/plugins-and-mcp.md)                           |
| Retired, compatibility-only, generated, and absent surfaces      | [`generated-and-legacy.md`](../../docs/structure/generated-and-legacy.md)                 |
| Scripts, Vite, test lanes, dev server, and operations            | [`testing-and-operations.md`](../../docs/structure/testing-and-operations.md)             |
