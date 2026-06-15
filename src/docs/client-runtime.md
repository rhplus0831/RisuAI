# Client Runtime Guide

Last audited: 2026-06-15.

This file covers browser TypeScript areas that influence visible Svelte UI. For
component ownership and UI triage, start with `src/docs/svelte-ui.md`.

The runtime is Fastify-backed. The browser keeps a projection of server state in
`DBState.db`, renders Svelte UI from that projection, sends command mutations to
Fastify, listens for events, and hydrates large resources such as chat messages
on demand.

## Client TypeScript Areas

| Path                                                                                                                                                                           | Runtime ownership                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/ts/server/`                                                                                                                                                               | Fastify browser adapters: bootstrap, commands, projection resources, hydration, events, active writer, assets, backups, Realm import, memory job events, bridge watchers, protocol diagnostics, smoke hooks. |
| `src/ts/storage/`                                                                                                                                                              | Browser projection database, server-backed auth/storage compatibility, `.risu` helpers, backup helpers, and auto-storage selection.                                                                          |
| `src/ts/process/`                                                                                                                                                              | `sendChat`, server-backed generation bridge, durable reattach, files/MCP/memory/embedding/post-generation helpers, retained parity helpers.                                                                  |
| `src/ts/process/request/`                                                                                                                                                      | Provider/server-routing classifiers, chat/completion/memory request adapters, SSE parsing, message patch helpers.                                                                                            |
| `src/ts/model/`, `src/ts/horde/`                                                                                                                                               | Browser model registry and provider catalog helpers used by settings and generation preflight.                                                                                                               |
| `src/ts/plugins/`                                                                                                                                                              | Browser plugin loading/runtime and Plugin V3 API host. Fastify stores plugin records but does not execute plugins.                                                                                           |
| `src/ts/process/mcp/`                                                                                                                                                          | Browser MCP clients, internal tools, Risu access tools, and plugin MCP clients.                                                                                                                              |
| `src/ts/media/`, `src/ts/parser/`, `src/ts/gui/`, `src/ts/setting/`, `src/ts/translator/`, `src/ts/network/`, `src/ts/kei/`, `src/ts/util/`                                    | Focused helper domains that feed visible UI and tests.                                                                                                                                                       |
| `src/ts/stores.svelte.ts`, `src/ts/globalApi.svelte.ts`, `src/ts/characters.ts`, `src/ts/characterCards.ts`, `src/ts/hotkey.ts`, `src/ts/lite.ts`, `src/ts/observer.svelte.ts` | Cross-cutting browser stores, compatibility helpers, hotkeys, lite mode, observers, and character/card utilities.                                                                                            |

Retained compatibility and parity helpers still exist under `src/ts/process/`,
but they are not a selectable browser-local runtime. `src/ts/platform.ts`
hard-codes Fastify mode.

## Startup Sequence

`src/main.ts` installs the router, mounts `App.svelte`, optionally installs the
Fastify browser smoke hook, calls `loadData()`, initializes hotkeys, and removes
the preloading element.

`loadData()` in `src/ts/bootstrap.ts` performs the visible startup work:

1. Fetch `/api/v1/bootstrap` through `fetchServerBootstrapProjection()`.
2. If the server has no database, initialize a fresh server database and refetch
   the read-only projection.
3. Apply the server database into `DBState.db`.
4. Merge bootstrap body-cache entries for heavy module/plugin bodies.
5. Seed selected character state from the projection.
6. Record hydrated lorebook coverage.
7. Cache the server command revision.
8. Enable the projection write guard.
9. Seed active generation jobs and start durable reattach.
10. Hydrate the selected character shell, start prompt-template hydration, start
    chat message hydration, and hydrate the active chat.
11. Start bridge patch lifecycle flushing.
12. Subscribe to server events.
13. Load plugins.
14. Update color scheme, text theme, animation speed, height mode, error
    handling, and GUI size CSS variables.
15. Apply startup UI state such as `botSettingAtStart`.
16. Set `loadedStore`, start DOM observers, register dynamic models, run module
    update, and show TOS as needed.

Visible startup bugs often sit at the boundary between `loadedStore`,
`selectedCharID`, projection application, route application, and CSS variable
updates.

## Projection And Hydration

The browser should treat Fastify projection data as the source of durable truth.
Use command helpers for user mutations and bridge watchers for compatibility
paths.

Important files:

- `src/ts/server/projectionWriteGuard.svelte.ts` protects server-owned
  projection state from direct browser mutation.
- `src/ts/server/bootstrapBodyCache.ts` merges cached module/plugin body payloads
  advertised by bootstrap.
- `src/ts/server/commands.ts` sends revision-checked command mutations.
- `src/ts/server/events.ts` subscribes to `/api/v1/events`.
- `src/ts/server/projectionResync.ts` handles full or targeted resync after
  revision gaps.
- `src/ts/server/chatMessageHydration.svelte.ts` hydrates active chat messages
  and transcript windows.
- `src/ts/server/characterShellHydration.svelte.ts` hydrates selected inactive
  character shell rows.
- `src/ts/server/promptTemplateHydration.ts` hydrates stripped prompt-template
  and preset prompt bodies.
- `src/ts/server/lorebookBridge.svelte.ts`, `chatBridge.svelte.ts`,
  `characterBridge.svelte.ts`, `promptTemplateBridge.svelte.ts`,
  `scriptDefinitionBridge.svelte.ts`, and `settingsBridge.svelte.ts` bridge
  visible UI state to command-backed server changes.

If a component shows stale or missing data, confirm whether the data is:

- absent from bootstrap by design;
- waiting on chat, lorebook, character shell, prompt template, preset, or
  module/plugin body-cache hydration;
- hidden by a route/store condition;
- optimistically changed but awaiting command confirmation;
- rolled back after command failure;
- overwritten by an SSE event or resync.

Detailed bootstrap, targeted projection, hydration, SSE reconcile, projection
write guard, and bridge watcher rules live in
`docs/structure/server-projection-and-bridges.md`.

## Generation Client

`sendChat` in `src/ts/process/index.svelte.ts` is the browser coordinator for
chat generation UI. In Fastify mode it uses server prompt assembly and server
provider dispatch.

Important files:

- `src/ts/process/index.svelte.ts` owns `doingChat`, `chatProcessStage`,
  active abort controller state, and the high-level `sendChat` coordinator used
  by `DefaultChatScreen.svelte`.
- `src/ts/process/request/providerCapability.ts` and
  `resolveServerPromptAssembly()` decide whether the selected request can run on
  the server.
- `src/ts/process/serverBackedSendChat.ts` builds server requests, maps legacy
  inlay ids to server asset refs, calls `/api/v1/generate/chat` or the preview
  route, applies server message patches, and returns terminal data.
- `src/ts/process/request/serverChat.ts` parses chat SSE frames: job, stage,
  prompt, patch, info, token, side-effect, warning, error, and done.
- `src/ts/process/reattach.ts` uses bootstrap `activeGenerationJobs` to reattach
  the current chat to durable server jobs.

Durable sends such as send, continue, and regenerate set `durable: true` when
allowed. Disconnect detaches from durable jobs; abort/cancel uses the durable
DELETE path when a job exists. Terminal `postGeneration` data can advance the
revision cache. Generation results are persisted server-side, so the browser
suppresses the old generation-result command in server-backed paths.

When generation UI is wrong, inspect both the Svelte surface
`src/lib/ChatScreens/DefaultChatScreen.svelte` and the runtime files above.

## Assets, Storage, Realm, Plugins, MCP

Assets:

- Single uploads go through `/api/v1/assets`.
- Bulk uploads go through `/api/v1/assets/bulk`.
- Browser helpers live in `src/ts/server/assets.ts` and
  `src/ts/globalApi.svelte.ts`.
- Visible asset URLs normalize to `/api/v1/assets/:id`.

Storage:

- `src/ts/storage/fastifyStorage.ts` backs `/api/v1/storage/*` compatibility
  endpoints.
- `src/ts/storage/autoStorage.ts` selects the server-backed storage adapter.
- `.risu` and backup helpers remain under `src/ts/storage/`.

Realm import:

- `src/ts/server/realmImport.ts` handles Realm character import, progress SSE,
  and projection reconciliation after commit.
- Visible Realm UI is under `src/lib/UI/Realm/`.

Plugins:

- Browser plugin code executes only in the browser runtime under
  `src/ts/plugins/`.
- Fastify stores plugin records/storage but does not execute plugin code.
- Plugin UI can register extra settings/menu/chat/floating controls through
  stores in `src/ts/stores.svelte.ts`.
- Module `.risum` import is unsupported in Fastify-backed browser mode. Add a
  server import/command route if it returns.

MCP:

- Browser MCP clients and tools live under `src/ts/process/mcp/`.
- Playground MCP UI lives in `src/lib/Playground/PlaygroundMCP.svelte`.

## Runtime Risks For UI Work

- Direct `DBState.db` mutation can fail under the projection write guard or be
  lost on SSE/resync. Use command helpers or bridge utilities.
- Bootstrap may intentionally provide stubs. Active chat messages and lorebooks
  can hydrate later.
- Route effects run only after `loadedStore`; a pre-load store write may not
  mean the URL or visible shell has caught up.
- CSS variables are applied after projection and settings load. A theme bug may
  be runtime state, not component markup.
- Plugins can add visible menu items and buttons. Check plugin stores before
  assuming a component owns every visible control.
- Full-stack visible bugs often need `pnpm dev:agent` or browser smoke because
  unit tests with fetch mocks can miss auth, SSE, projection, and asset URL
  wiring.

## Verification Pointers

Use the smallest command that covers the touched area:

```sh
pnpm check
pnpm test
pnpm coverage:ui-map
pnpm smoke:fastify-browser
```

For server TypeScript checks after client type changes that server imports use:

```sh
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
