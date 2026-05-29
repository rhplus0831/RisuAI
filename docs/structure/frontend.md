# Frontend Map

The frontend is a Svelte 5 SPA. It is now server-backed: Fastify owns persisted
state and many side effects, while the browser owns rendering, input handling,
SSE application, display state, TTS playback, image previews, and plugin runtime.

## Entry And Shell

- `index.html` mounts the SPA into `#app` and loads `/src/main.ts`.
- `src/main.ts` imports polyfills and storage initialization, mounts
  `src/App.svelte`, calls `loadData()`, initializes hotkeys, installs the smoke
  hook when requested, and removes the preload DOM.
- `src/App.svelte` is the main UI shell. It imports sidebar, chat screen,
  settings, mobile, modal, welcome, and popup components. Its top-level render
  switch chooses loading, legal/setup, settings, mobile UI, grid/catalog, or the
  regular sidebar plus chat surface.
- `src/LiteMain.svelte` is the lite UI entry shell used by the lite/mobile-ish
  path.

## Directory Guide

| Path                   | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `src/lib/ChatScreens/` | Chat rendering and chat interaction components.                        |
| `src/lib/SideBars/`    | Sidebar, character config, lorebook, scripts, and navigation surfaces. |
| `src/lib/Setting/`     | Settings pages and wrapper controls.                                   |
| `src/lib/Mobile/`      | Mobile shell components.                                               |
| `src/lib/LiteUI/`      | Lite UI components.                                                     |
| `src/lib/Playground/`  | Playground/tooling UI surfaces.                                        |
| `src/lib/UI/`          | Shared UI primitives, GUI, NewGUI, Realm components.                   |
| `src/lib/Others/`      | Modals, alerts, welcome, editor, loadout, misc UI pieces.              |
| `src/lang/`            | Localization data.                                                     |
| `src/ts/`              | Non-component client and domain logic.                                 |

Useful `src/ts` subdirectories:

| Path              | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `src/ts/server/`  | Browser adapters for Fastify bootstrap, commands, events, backups, assets.         |
| `src/ts/storage/` | Client database state, server-backed storage, `.risu` import/export.               |
| `src/ts/process/` | Request flow, prompt/client-side helpers, memory client adapters, post-generation. |
| `src/ts/model/`   | Client model lists and provider-related browser logic.                             |
| `src/ts/parser/`  | Chat/parser utilities and tests.                                                   |
| `src/ts/plugins/` | Plugin loading and browser-side plugin runtime.                                    |
| `src/ts/media/`   | Image/media helpers and compression.                                               |
| `src/ts/gui/`     | Theme, GUI size, color scheme, and display helpers.                                |
| `src/ts/kei/`     | Risu-Kei backup integration.                                                       |

## Server Projection Flow

Startup is server-backed only when the SPA is served by Fastify and
`globalThis.__FASTIFY__` is injected:

1. `src/main.ts` calls `loadData()`.
2. `src/ts/bootstrap.ts` calls `fetchServerBootstrapProjection()`.
3. `src/ts/server/bootstrap.ts` requests `/api/v1/bootstrap` with `risu-auth`.
4. `src/ts/storage/database.svelte.ts` applies the projection into `DBState.db`.
5. The projection write guard is enabled so normal browser code cannot mutate
   server-owned state directly.
6. `src/ts/server/events.ts` subscribes to `/api/v1/events`.
7. Command events trigger a debounced full bootstrap refresh. Memory events can
   update Hypa V3 progress UI directly.

When debugging stale UI, check command success revision, the SSE event stream,
and the debounced bootstrap refresh before assuming a Svelte rendering problem.

## Server Commands From The Browser

Browser code should not directly mutate projected server state. Use server
command helpers instead.

Important files:

- `src/ts/server/commands.ts` has the generic command transport, revision cache,
  settings grouping, and many command wrappers.
- `src/ts/characterCommands.ts`, `src/ts/chatCommands.ts`,
  `src/ts/moduleCommands.ts`, and `src/ts/pluginCommands.ts` expose narrower
  domain helpers.
- `src/ts/server/projectionWriteGuard.svelte.ts` traps accidental projection
  writes in Fastify mode.

If a UI change needs to persist state, find or add a command route on the server,
then call it through a browser-side command helper.

## Fastify SPA Integration

Vite dev mode and production Fastify serving differ:

- `pnpm dev` starts Vite on `0.0.0.0:5174` and proxies `/api` to
  `RISU_API_PROXY_TARGET` or `http://localhost:6002`, but it does not inject the
  Fastify marker. `isFastifyServer` is false in this mode.
- Production/static serving uses `dist/` by default through
  `RISU_API_STATIC_ROOT`.
- Fastify injects `globalThis.__FASTIFY__ = true` into served `index.html`.
- `src/ts/platform.ts` reads `__FASTIFY__` to enable Fastify-backed behavior.

## Assets And Storage

Fastify mode asset uploads go through `/api/v1/assets`; asset URLs normalize to
`/api/v1/assets/:id`. The source-side helpers are in `src/ts/globalApi.svelte.ts`
and `src/ts/server/assets.ts`.

`src/ts/storage/nodeStorage.ts` still backs active `/api/v1/storage/*` endpoints.
Despite the route filename `legacyStorage.ts`, this bridge is part of the current
Fastify web runtime.
