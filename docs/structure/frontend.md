# Frontend Map

The frontend is a Svelte 5 SPA. It is server-backed: Fastify owns durable state
and most side effects; the browser owns rendering, input handling, SSE
application, display state, TTS playback, media previews, and plugin execution.

## Entry And Shell

| Path                  | Role                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `index.html`          | Mounts `#app` and loads `/src/main.ts`.                                                                                       |
| `src/main.ts`         | Imports polyfills/storage state, mounts `App.svelte`, installs optional smoke hook, calls `loadData()`, initializes hotkeys.  |
| `src/App.svelte`      | Main UI shell and render switch for setup/legal/loading/settings/mobile/grid/sidebar/chat plus modal overlays.                |
| `src/styles.css`      | Tailwind v4 import, theme variables, global app CSS.                                                                          |
| `src/ts/bootstrap.ts` | Browser startup coordinator: Fastify bootstrap, first-run initialize, projection guard, events, hydration, plugins, UI state. |
| `src/ts/platform.ts`  | Hard-codes `isFastifyServer = true`; no browser-local runtime switch.                                                         |

`src/LiteMain.svelte` exists but is not the live entrypoint. Live lite mode is
`VITE_RISU_LITE` driving branches in `src/App.svelte` and `src/ts/lite.ts`.
There is no SvelteKit `src/routes/`; navigation is store/render-switch driven.

Vite dev (`pnpm dev`) uses strict port 5174 and proxies `/api` to
`RISU_API_PROXY_TARGET` or `http://localhost:6002`. `pnpm build` and
`pnpm buildsite` produce the production bundle.

## Component Directories

| Path                                                  | Purpose                                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ChatScreens/`                                | Chat rendering and interaction components.                                                                                                                                                                          |
| `src/lib/SideBars/`                                   | Sidebar, character config, chat list, lorebook, scripts, navigation.                                                                                                                                                |
| `src/lib/Setting/`, `src/lib/Setting/Pages/`          | Settings layout, wrappers, concrete pages, and `Advanced/`, `Display/`, `Language/`, `Model/`, `Module/` subfolders. Provider-facing settings live mostly in `BotSettings.svelte` and provider-specific page files. |
| `src/lib/Mobile/`                                     | Mobile shell components.                                                                                                                                                                                            |
| `src/lib/LiteUI/`                                     | Lite shell support components.                                                                                                                                                                                      |
| `src/lib/Playground/`                                 | Parser/tokenizer/MCP/image/translation/tooling playgrounds.                                                                                                                                                         |
| `src/lib/UI/`, `src/lib/UI/GUI/`, `src/lib/UI/Realm/` | Shared UI primitives, dense GUI controls, model pickers, Realm UI.                                                                                                                                                  |
| `src/lib/Others/`                                     | Modals, alerts, editor, loadout, Hypa V3, popup/misc pieces.                                                                                                                                                        |
| `src/lang/`                                           | Localization data.                                                                                                                                                                                                  |
| `src/etc/`                                            | Bundled docs/media/tokenizer seed data imported by the client.                                                                                                                                                      |

## Client TypeScript Areas

| Path                                                                                                                                        | Purpose                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ts/server/`                                                                                                                            | Fastify adapters for bootstrap, commands, projection, hydration, events, active writer, assets, backups, Realm import, memory job events, bridge watchers, protocol diagnostics, smoke hooks. |
| `src/ts/storage/`                                                                                                                           | Client projection state, server-backed auth/storage, `.risu` and backup helpers.                                                                                                              |
| `src/ts/process/`                                                                                                                           | `sendChat`, server-backed generation bridge, reattach, retained parity helpers, files/MCP/memory/embedding/post-generation helpers.                                                           |
| `src/ts/process/request/`                                                                                                                   | Shared provider/server-routing classifiers plus chat/completion/memory/SSE/message-patch adapters.                                                                                            |
| `src/ts/model/`, `src/ts/horde/`                                                                                                            | Browser model registry and provider catalog helpers.                                                                                                                                          |
| `src/ts/plugins/`                                                                                                                           | Browser plugin loading/runtime and Plugin V3 API host.                                                                                                                                        |
| `src/ts/process/mcp/`                                                                                                                       | Browser MCP clients, internal tools, Risu access tools, plugin MCP clients.                                                                                                                   |
| `src/ts/media/`, `src/ts/parser/`, `src/ts/gui/`, `src/ts/setting/`, `src/ts/translator/`, `src/ts/network/`, `src/ts/kei/`, `src/ts/util/` | Focused helper domains and tests.                                                                                                                                                             |
| `src/ts/stores.svelte.ts`, `globalApi.svelte.ts`, `characters.ts`, `characterCards.ts`, `hotkey.ts`, `lite.ts`, `observer.svelte.ts`        | Cross-cutting browser stores and compatibility helpers.                                                                                                                                       |

Retained compatibility/parity helpers still exist under `src/ts/process/`, but
do not treat them as a selectable browser-local runtime.

## Startup And Projection

Startup is Fastify-backed in Vite dev and production. `src/main.ts` calls
`loadData()`, which fetches/applies the Fastify bootstrap projection, seeds
revision state, starts active-generation reattach, hydrates active chat/lorebook
data on demand, and subscribes to `/api/v1/events`.

Detailed bootstrap, targeted projection, hydration, SSE reconcile, projection
write guard, and bridge watcher rules live in
`server-projection-and-bridges.md`.

## Generation Client

`sendChat` in `src/ts/process/index.svelte.ts` is the browser coordinator.
Fastify mode uses server prompt assembly and server provider dispatch:

- `resolveServerPromptAssembly()` plus `providerCapability.ts` return `server`
  or `unsupported` for live Fastify sends.
- `src/ts/process/serverBackedSendChat.ts` builds the server request, maps
  legacy inlay ids to server asset refs, calls `/api/v1/generate/chat` or the
  preview route, applies server message patches, and returns terminal generation
  data to the coordinator.
- `src/ts/process/request/serverChat.ts` parses chat SSE frames including job,
  stage, prompt, patch, info, token, side-effect, warning, error, and done.
- Server-dispatch paths persist generation results server-side, so the browser
  suppresses its old generation-result command.

Durable sends (`send`, `continue`, `regenerate`) send `durable: true` when
allowed. Bootstrap `activeGenerationJobs` drives current-chat reattach through
`src/ts/process/reattach.ts` and `reattachServerBackedSendChat()`.

## Assets, Storage, Realm, Plugins

Single asset uploads go through `/api/v1/assets`; bulk saves use
`/api/v1/assets/bulk`. Asset references normalize to `/api/v1/assets/:id`.
Browser helpers live in `src/ts/server/assets.ts` and `src/ts/globalApi.svelte.ts`.

`src/ts/storage/fastifyStorage.ts` backs current `/api/v1/storage/*`
compatibility endpoints, instantiated by `src/ts/storage/autoStorage.ts`.

Realm character import uses `src/ts/server/realmImport.ts`, including progress
SSE and projection reconciliation after commit.

Browser plugin code runs only in the browser runtime under `src/ts/plugins/`.
Fastify stores plugin records/storage but does not execute plugin code. Module
`.risum` import remains unsupported in Fastify-backed browser mode; add a server
import/command route if it returns.
