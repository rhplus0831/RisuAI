# Source Docs

Last audited: 2026-08-09.

These five guides are the current frontend and browser-runtime documentation
for work under `src/`. Start with the narrowest owner instead of duplicating a
contract in a neighboring guide.

| File | Owns |
| ---- | ---- |
| [`svelte-ui.md`](svelte-ui.md) | Svelte application shell, render priority, routes/stores, localization, styling, responsive/Lite behavior, and Playground. |
| [`svelte-chat-ui.md`](svelte-chat-ui.md) | Chat frame, transcript and message rendering, composer variants, generation/loading feedback, and in-chat confirmations. |
| [`svelte-navigation-ui.md`](svelte-navigation-ui.md) | Sidebar, Mood Light controls, character/chat selection and configuration, and list reordering. |
| [`svelte-settings-ui.md`](svelte-settings-ui.md) | Settings routing, data-driven rows, shared controls, authoring editors, model-profile UI, and visible persistence states. |
| [`client-runtime.md`](client-runtime.md) | Browser startup, resources, hydration, durable mutations and recovery, generation reattach, and server-operation adapters. |

Continue with the canonical focused architecture guide for cross-layer
contracts:

| Topic | Canonical guide |
| ----- | --------------- |
| Resource reads, hydration, commands, and reconciliation | [`server-resources-and-bridges.md`](../../docs/structure/server-resources-and-bridges.md) |
| Assets, saves, backups, Realm, and content exchange | [`assets-and-saves.md`](../../docs/structure/assets-and-saves.md) |
| Providers, model resolution, credentials, and request options | [`providers-and-models.md`](../../docs/structure/providers-and-models.md) |
| Prompt assembly, CBS, and script execution | [`prompt-assembly-and-scripting.md`](../../docs/structure/prompt-assembly-and-scripting.md) |
| Translation and input-hook execution | [`translation-and-input-hooks.md`](../../docs/structure/translation-and-input-hooks.md) |
| Agent/Agent Preset planning and execution | [`agents-and-presets.md`](../../docs/structure/agents-and-presets.md) |
| Plugin surfaces, storage/execution, and MCP | [`plugins-and-mcp.md`](../../docs/structure/plugins-and-mcp.md) |
| Retired, compatibility-only, generated, and absent paths | [`generated-and-legacy.md`](../../docs/structure/generated-and-legacy.md) |
| Test policy, scripts, CI, and local operations | [`testing-and-operations.md`](../../docs/structure/testing-and-operations.md) |
