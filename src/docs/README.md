# Source Docs

Last audited: 2026-08-27.

These six guides are the current frontend and browser-runtime documentation
for work under `src/`. Start with the narrowest owner instead of duplicating a
contract in a neighboring guide.

| File | Owns |
| ---- | ---- |
| [`svelte-ui.md`](svelte-ui.md) | Svelte application shell, render priority, routes/stores, localization, styling, responsive/Lite behavior, and Playground. |
| [`svelte-chat-ui.md`](svelte-chat-ui.md) | Chat frame, transcript and message rendering, composer variants, generation/loading feedback, and in-chat confirmations. |
| [`svelte-navigation-ui.md`](svelte-navigation-ui.md) | Sidebar, character folders, character/chat selection and configuration, and list reordering. |
| [`svelte-settings-ui.md`](svelte-settings-ui.md) | Settings routing, data-driven rows, shared controls, authoring editors, model-profile UI, and visible persistence states. |
| [`client-runtime.md`](client-runtime.md) | Browser startup, resources, hydration, durable mutations/recovery, and server-operation adapters. |
| [`generation-client.md`](generation-client.md) | Durable generation acceptance, streaming, cancellation, reattach, terminal reconciliation, effects, half-streaming, and completion audio. |

Continue with the canonical focused architecture guide for cross-layer
contracts:

| Topic | Canonical guide |
| ----- | --------------- |
| Bootstrap resources, cache, reads, and hydration | [`server-resources-and-bridges.md`](../../docs/structure/server-resources-and-bridges.md) |
| Durable mutations, event recovery, bridges, and writer loss | [`durable-mutations-and-recovery.md`](../../docs/structure/durable-mutations-and-recovery.md) |
| Assets, saves, backups, Realm, and content exchange | [`assets-and-saves.md`](../../docs/structure/assets-and-saves.md) |
| Providers, model resolution, credentials, and request options | [`providers-and-models.md`](../../docs/structure/providers-and-models.md) |
| Prompt assembly, CBS, and script execution | [`prompt-assembly-and-scripting.md`](../../docs/structure/prompt-assembly-and-scripting.md) |
| Translation and input-hook execution | [`translation-and-input-hooks.md`](../../docs/structure/translation-and-input-hooks.md) |
| Agent/Agent Preset planning and execution | [`agents-and-presets.md`](../../docs/structure/agents-and-presets.md) |
| Plugin surfaces, storage/execution, and MCP | [`plugins-and-mcp.md`](../../docs/structure/plugins-and-mcp.md) |
| Retired, compatibility-only, generated, and absent paths | [`generated-and-legacy.md`](../../docs/structure/generated-and-legacy.md) |
| Test policy, scripts, CI, TypeScript, and formatting | [`testing-and-operations.md`](../../docs/structure/testing-and-operations.md) |
| Local dev, tracing, startup metrics, environment, and browser support | [`development-and-observability.md`](../../docs/structure/development-and-observability.md) |
