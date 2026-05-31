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
- `src/LiteMain.svelte` exists, but it is not a current entrypoint. The live
  lite/mobile-ish path is `VITE_RISU_LITE` + `src/ts/lite.ts` driving
  `src/App.svelte`'s mobile branch.

## Directory Guide

| Path                   | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `src/lib/ChatScreens/` | Chat rendering and chat interaction components.                        |
| `src/lib/SideBars/`    | Sidebar, character config, lorebook, scripts, and navigation surfaces. |
| `src/lib/Setting/`     | Settings pages and wrapper controls.                                   |
| `src/lib/Mobile/`      | Mobile shell components.                                               |
| `src/lib/LiteUI/`      | Lite UI components.                                                    |
| `src/lib/Playground/`  | Playground/tooling UI surfaces.                                        |
| `src/lib/UI/`          | Shared UI primitives, GUI, and Realm components.                       |
| `src/lib/Others/`      | Modals, alerts, welcome, editor, loadout, misc UI pieces.              |
| `src/lang/`            | Localization data.                                                     |
| `src/ts/`              | Non-component client and domain logic.                                 |

Useful `src/ts` subdirectories:

| Path                      | Purpose                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ts/server/`          | Browser adapters for Fastify bootstrap, commands, events, backups, assets, active-writer headers, projection/hydration, bridge watchers, settings bridge, Realm import, and smoke hooks. |
| `src/ts/storage/`         | Client database state, server-backed storage, `.risu` import/export.                                                                                                                     |
| `src/ts/process/`         | Request flow (`index.svelte.ts` = `sendChat`), prompt/client-side helpers, memory client adapters, post-generation.                                                                      |
| `src/ts/process/request/` | Server-vs-local routing: `serverPromptAssembly.ts` + `durableGeneration.ts` classifiers, the `providerCapability.ts` table, and the `/chat` SSE adapter (`serverChat.ts`).               |
| `src/ts/model/`           | Client model lists and provider-related browser logic.                                                                                                                                   |
| `src/ts/parser/`          | Chat/parser utilities and tests.                                                                                                                                                         |
| `src/ts/plugins/`         | Plugin loading and browser-side plugin runtime.                                                                                                                                          |
| `src/ts/media/`           | Image/media helpers and compression.                                                                                                                                                     |
| `src/ts/gui/`             | Theme, GUI size, color scheme, and display helpers.                                                                                                                                      |
| `src/ts/setting/`         | Data-driven settings metadata and custom setting component helpers.                                                                                                                      |
| `src/ts/translator/`      | Translator presets and browser-side translation helpers.                                                                                                                                 |
| `src/ts/network/`         | Local-network and proxy-stream WebSocket helpers.                                                                                                                                        |
| `src/ts/kei/`             | Risu-Kei backup integration.                                                                                                                                                             |

Useful `src/ts/process` subdirectories:

| Path                             | Purpose                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/ts/process/request/`        | Server/local request routing, provider capability checks, server chat/completion/memory adapters, SSE parsing. |
| `src/ts/process/dispatch/`       | Local provider dispatch helper used by `sendChat` when the Fastify server path is not selected.                |
| `src/ts/process/models/`         | Request-time model string and provider-specific prompt string helpers retained for local paths.                |
| `src/ts/process/embedding/`      | Additional-information embedding helpers retained for local Hypa flows.                                        |
| `src/ts/process/dynamicutils/`   | Dynamic file utilities such as PDF-to-image/text extraction.                                                   |
| `src/ts/process/promptAssembly/` | Browser-side prompt assembly helpers retained for local/non-Fastify paths and parity tests.                    |
| `src/ts/process/promptBudget/`   | Token-budget preflight/finalization helpers.                                                                   |
| `src/ts/process/postGeneration/` | Browser-side post-generation helpers used by local paths and tests.                                            |
| `src/ts/process/mcp/`            | MCP clients, internal MCP tools, and Risu access wrappers.                                                     |
| `src/ts/process/memory/`         | Browser-side memory engines/helpers retained around Hypa flows and local code paths.                           |
| `src/ts/process/files/`          | File/inlay/multisend helpers.                                                                                  |
| `src/ts/process/templates/`      | Prompt/template rendering helpers.                                                                             |

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
7. Command events enter a serial surgical-sync chain in `src/ts/bootstrap.ts`:
   own echoes / already-applied revisions are skipped, contiguous foreign events
   fetch `GET /api/v1/projection/:resource`, and gaps, reconnects, or projection
   errors fall back to a full bootstrap refresh.
8. Memory events can update Hypa V3 progress UI directly.

When debugging stale UI, check command success revision, the SSE event stream,
targeted projection responses, and the full-bootstrap fallback before assuming a
Svelte rendering problem.

Chat messages are not shipped in normal bootstrap/projection payloads. The open
chat hydrates through `GET /api/v1/projection/chatMessages?id=...`, including
per-chat `hypaV3Data` and persisted reroll alternates. If
`enableLorebookStubs` is on, the open character's `globalLore` hydrates through
`GET /api/v1/projection/characterLorebook?id=...`; this path is still guarded as
experimental in the server repository comments.

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
   parses the SSE stream via `src/ts/process/request/serverChat.ts`. Chat streams
   may include durable `job_accepted`, stage, prompt, `message_patch`, info,
   token, `side_effect`, warning, error, and done frames. The browser renders
   streamed tokens, collects side effects, reconciles revisions, and applies the
   server's post-generation patch + final text from `done.postGeneration`.
3. On every server-dispatch path the server persists the final generation result, so
   the browser suppresses its old generation-result command. Browser persistence remains
   only for the local assembler/dispatcher path.

### Durable generation (browser side)

When `resolveDurableGeneration(...) === 'durable'` (a server-assembled `send`,
`continue`, or `regenerate`), the browser sends `durable: true`, keeps rendering the
live stream, and **does not persist the result** (the server does, at job completion).
The stop button maps to `cancelServerChatGeneration` →
`DELETE /api/v1/generate/chat/:id` (a bare disconnect no longer cancels). Bootstrap
also surfaces `activeGenerationJobs`; `src/ts/process/reattach.ts` consumes it and
re-drives `sendChat` against `GET /api/v1/generate/chat/:id/stream` for the open chat.

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
For example, the DevTool variable editor uses the chat scriptstate command helper
for durable scriptstate changes; form controls should not bind directly into
`DBState.db` for server-owned fields.

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

Realm character imports use `src/ts/server/realmImport.ts`, which can consume the
server's progress SSE and reconcile the command revision after the imported
character is committed.

`src/ts/storage/nodeStorage.ts` still backs active `/api/v1/storage/*` endpoints.
Despite the route filename `legacyStorage.ts`, this bridge is part of the current
Fastify web runtime.
