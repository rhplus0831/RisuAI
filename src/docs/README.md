# Source Docs

Last audited: 2026-07-06.

These notes are the current frontend/client documentation for agents working in
`src/`. They replace the old compact frontend map under `docs/structure/`.

| File                         | Use                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/docs/svelte-ui.md`      | First stop for Svelte UI/UX work: app shell, route/store rendering, settings, shared controls, chat, sidebar, modals, mobile/lite, playground, styling, and visible-state tests. |
| `src/docs/client-runtime.md` | Browser runtime touchpoints that shape visible UI: Fastify bootstrap/projection, hydration, command bridges, generation client, assets, storage, Realm import, plugins, and MCP. |

For backend protocol, persistence, and operational details, continue through
the focused notes under `docs/structure/`.
