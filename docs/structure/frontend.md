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
| `src/ts/process/` | Request flow (`index.svelte.ts` = `sendChat`), prompt/client-side helpers, memory client adapters, post-generation. |
| `src/ts/process/request/` | Server-vs-local routing: `serverPromptAssembly.ts` + `durableGeneration.ts` classifiers, the `providerCapability.ts` table, and the `/chat` SSE adapter (`serverChat.ts`). |
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

## Server-Side Generation Flow

`sendChat` (`src/ts/process/index.svelte.ts`) is the browser orchestrator. In Fastify
mode the **server owns prompt assembly and the provider call** by default
(`useServerPromptAssembly` defaults `true`):

1. The send is classified by `resolveServerPromptAssembly`
   (`src/ts/process/request/serverPromptAssembly.ts`) + the shared
   `resolveProviderCapability` table — `local | server | unsupported`. `unsupported`
   throws (no silent fallback); `local` only happens when `!isFastifyServer` or the
   flag is explicitly `false`.
2. For a `server` send the browser POSTs raw inputs to `/api/v1/generate/chat` and
   consumes the SSE stream (stage / prompt / `message_patch` / info / token / error /
   done frames) via `src/ts/process/request/serverChat.ts`. It renders streamed tokens
   and applies the server's post-generation patch + final text from `done.postGeneration`.
3. On the **non-durable** path the browser still issues the final-message persistence
   command (B2). On the **durable** path the server persists the result, so the browser
   suppresses its persist call (EC-D4).

### Durable generation (browser side)

When `resolveDurableGeneration(...) === 'durable'` (a server-assembled `send`), the
browser sends `durable: true`, keeps rendering the live stream, and **does not persist
the result** (the server does, at job completion). The stop button maps to
`cancelServerChatGeneration` → `DELETE /api/v1/generate/chat/:id` (a bare disconnect no
longer cancels). The browser does **not** yet auto-reattach to a running job after a
mid-generation disconnect / reload — the server surfaces `activeGenerationJobs` from
bootstrap, but consuming it is a documented follow-up ([`../leftover.md`](../leftover.md)).

### Active-writer lease

Distinct from the projection write guard: a single browser session holds the
**write/send lease**. It is registered through the writer-intent bootstrap request and
carried as `risu-writer-session` on server-owned mutations. A newer session takes over;
a stale session gets `423 active_writer_stale` on its next mutation and must reload.
This is the submission-authorization layer the durable one-job-per-chat rule sits on.

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
