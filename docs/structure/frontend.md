# Frontend Map

The frontend is a Svelte 5 SPA. It is server-backed: Fastify owns durable state
and most side effects; the browser owns rendering, input handling, SSE
application, display state, TTS playback, media previews, and plugin runtime.

## Entry And Shell

| Path                  | Role                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `index.html`          | Mounts the app into `#app` and loads `/src/main.ts`.                                                                          |
| `src/main.ts`         | Imports polyfills/storage state, mounts `App.svelte`, installs optional smoke hook, calls `loadData()`, initializes hotkeys.  |
| `src/App.svelte`      | Main UI shell and top-level render switch for setup/legal/loading/settings/mobile/grid/sidebar/chat plus modal overlays.      |
| `src/ts/bootstrap.ts` | Browser startup coordinator: Fastify bootstrap, first-run initialize, projection guard, events, hydration, plugins, UI state. |
| `src/ts/platform.ts`  | Hard-codes `isFastifyServer = true`; no browser-local runtime switch.                                                         |

`src/LiteMain.svelte` exists but is not the live entrypoint. Current lite mode is
`VITE_RISU_LITE` driving `src/App.svelte`'s mobile branch. There is no
SvelteKit-style `src/routes/`; navigation is store/render-switch driven.

## Directory Guide

| Path                   | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `src/lib/ChatScreens/` | Chat rendering and interaction components.                           |
| `src/lib/SideBars/`    | Sidebar, character config, chat list, lorebook, scripts, navigation. |
| `src/lib/Setting/`     | Settings pages, model/module/plugin settings, wrapper controls.      |
| `src/lib/Mobile/`      | Mobile shell components.                                             |
| `src/lib/LiteUI/`      | Unwired lite shell support components.                               |
| `src/lib/Playground/`  | Parser/tokenizer/MCP/image/translation/tooling playgrounds.          |
| `src/lib/UI/`          | Shared UI primitives, GUI controls, model pickers, Realm UI.         |
| `src/lib/Others/`      | Modals, alerts, editor, loadout, Hypa V3, popup/misc pieces.         |
| `src/lang/`            | Localization data.                                                   |
| `src/etc/`             | Bundled docs/media/tokenizer seed data imported by the client.       |
| `src/styles.css`       | Global Tailwind v4 import, theme variables, app CSS.                 |

Useful `src/ts` areas:

| Path                                                                                                                                        | Purpose                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ts/server/`                                                                                                                            | Fastify adapters for bootstrap, commands, projection, hydration, events, assets, backups, active writer, memory job events, Realm import, bridge watchers, protocol diagnostics, smoke hooks. |
| `src/ts/storage/`                                                                                                                           | Client projection state, server-backed auth/storage, `.risu` and backup helpers.                                                                                                              |
| `src/ts/process/`                                                                                                                           | `sendChat`, server-backed generation bridge, reattach, retained parity helpers, files/MCP/memory/embedding/post-generation helpers.                                                           |
| `src/ts/process/request/`                                                                                                                   | Shared provider/server-routing classifiers plus `/chat`, `/completion`, memory, SSE, and message-patch adapters.                                                                              |
| `src/ts/model/`, `src/ts/horde/`                                                                                                            | Browser model registry and provider catalog helpers.                                                                                                                                          |
| `src/ts/plugins/`                                                                                                                           | Browser plugin loading/runtime and Plugin V3 API host.                                                                                                                                        |
| `src/ts/process/mcp/`                                                                                                                       | Browser MCP clients, internal tools, Risu access tools, plugin MCP clients.                                                                                                                   |
| `src/ts/media/`, `src/ts/parser/`, `src/ts/gui/`, `src/ts/setting/`, `src/ts/translator/`, `src/ts/network/`, `src/ts/kei/`, `src/ts/util/` | Focused helpers and tests.                                                                                                                                                                    |

Retained compatibility/parity helpers still exist under `src/ts/process/dispatch`,
`models`, `embedding`, `promptAssembly`, `promptBudget`, `postGeneration`,
`memory`, `files`, and `templates`. Do not treat them as a selectable
browser-local runtime.

## Startup And Projection

Startup is Fastify-backed in Vite dev and production:

1. `src/main.ts` calls `loadData()`.
2. `src/ts/bootstrap.ts` calls `fetchServerBootstrapProjection()` with writer
   intent.
3. If bootstrap returns `database: null`, the browser calls
   `initializeServerDatabase()` and refetches bootstrap read-only.
4. The projection is applied into `DBState.db`, the revision cache is seeded,
   and the projection write guard is enabled.
5. `activeGenerationJobs` is handed to reattach logic.
6. Active chat hydration starts, then `/api/v1/events` subscribes with the
   cached revision.

Normal bootstrap/projection payloads contain chat stubs. The active chat uses
`GET /api/v1/projection/chatMessages?id=...` for messages, `hypaV3Data`, and
reroll alternates. Read-many flows use bulk endpoints:
`POST /api/v1/projection/chatMessages/bulk` and
`POST /api/v1/projection/characterLorebooks/bulk`. Stale-response drops and
hydration caches live in `src/ts/server/chatMessageHydration.svelte.ts`.

If `enableLorebookStubs` is on, the active character's `globalLore` hydrates via
`GET /api/v1/projection/characterLorebook?id=...`; this path remains guarded as
experimental.

## Events And Bridges

`src/ts/server/events.ts` subscribes to command/memory SSE. `src/ts/bootstrap.ts`
serializes command event handling:

- Own echoes and already-applied revisions are skipped.
- Contiguous foreign events fetch a targeted projection slice.
- Gaps, replay misses, projection errors, or unknown resources fall back to a
  read-only full bootstrap.
- Memory events update Hypa V3 job/progress UI directly.

Browser code should not directly mutate projected server state. Use command
helpers in `src/ts/server/commands.ts` and narrower wrappers such as
`characterCommands.ts`, `chatCommands.ts`, `moduleCommands.ts`, and
`pluginCommands.ts`.

Bridge files convert UI-local edits to commands:

- `settingsBridge.svelte.ts`
- `characterBridge.svelte.ts`
- `chatBridge.svelte.ts`
- `lorebookBridge.svelte.ts`
- `scriptDefinitionBridge.svelte.ts`

Some bridge helpers perform trusted optimistic writes and roll back on command
failure. Watcher-only bridges often observe/diff already-local state, track the
projection-apply epoch, queue debounced commands, and restore snapshots only
when needed.

## Generation Client

`sendChat` in `src/ts/process/index.svelte.ts` is the browser coordinator.
Fastify mode uses server prompt assembly and server provider dispatch:

1. `resolveServerPromptAssembly()` plus `resolveProviderCapability()` decides
   `server` or `unsupported`.
2. `src/ts/process/serverBackedSendChat.ts` builds the server request, maps
   legacy inlay ids to server asset refs, calls the `/chat` or preview route,
   applies server message patches, collects prompt/token/info data, and exposes
   the terminal generation result to the coordinator.
3. `src/ts/process/request/serverChat.ts` parses chat SSE frames. Frames can
   include `job_accepted`, stage, prompt, `message_patch`, info, token,
   `side_effect`, warning, error, and done.
4. The server persists generation results on server-dispatch paths, so the
   browser suppresses its old generation-result command.

Durable sends (`send`, `continue`, `regenerate`) send `durable: true` when
`resolveDurableGeneration()` allows it. Disconnect detaches the viewer; the stop
button calls `DELETE /api/v1/generate/chat/:id`. Bootstrap
`activeGenerationJobs` drives current-chat reattach through
`src/ts/process/reattach.ts` and `reattachServerBackedSendChat()`.

Lower-level completion uses `resolveServerCompletionRoute()` and
`src/ts/process/request/serverCompletion.ts`.

Local/legacy branches are not user-selectable in the live Fastify runtime; they
remain for reattach internals, parity tests, and compatibility scaffolding.

## Assets, Storage, And Realm

Fastify asset uploads go through `/api/v1/assets`; URLs normalize to
`/api/v1/assets/:id`. Browser helpers live in `src/ts/server/assets.ts` and
`src/ts/globalApi.svelte.ts`.

`src/ts/storage/fastifyStorage.ts` backs the current `/api/v1/storage/*`
compatibility endpoints, instantiated by `src/ts/storage/autoStorage.ts`.

Realm character import uses `src/ts/server/realmImport.ts`, including progress
SSE and projection reconciliation after commit.

Module `.risum` import remains unsupported in Fastify-backed browser mode; add
a server import/command route if it returns.
