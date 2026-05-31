# Server And Client Ownership Audit

Last audited: 2026-05-31.

This report uses the current codebase as the source of truth. The audit split was
checked with three read-only subagent passes: one for browser/client code, one for
`server/fastify`, and one for server-shaped leftovers. Local spot checks and
`pnpm client-thinning:audit` were run afterward.

Terminology:

- "Client" means the Svelte/browser app under `src/`.
- "Server" means the Fastify API under `server/fastify/`.
- `src/ts/server/*` is client code: it is the browser-side adapter layer that
  calls Fastify APIs, subscribes to SSE, and applies server projections.

## Summary

Fastify now owns the durable data boundary, command mutations, revision control,
prompt assembly for supported chat sends, server-routable generation, Hypa V3
memory jobs, content-addressed assets, import/export, backups, auth, and active
writer protection.

The browser still owns the product UI, transient interaction state, a hydrated
server projection, command adapters with optimistic UI behavior, stream
consumption, reattach/cancel controls, browser-only post-generation effects,
plugin/runtime surfaces, MCP/local tool orchestration, and the non-Fastify/local
compatibility stack.

The main server-owned responsibilities that still leak through the client are
client-built provider payloads for server completion, browser-local inlay bytes,
and the closeout path for local prompt assembly/provider dispatch.

## Current Client Responsibilities

| Area                                 | Current client responsibility                                                                                                                                                                                           | Evidence                                                                                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell and UI                     | Mounts the SPA, renders the Svelte shell, handles modals, sidebars, chat screens, asset inputs, drag/drop import, and other interaction state.                                                                          | `src/main.ts`, `src/App.svelte`, `src/lib/ChatScreens/Chat.svelte`, `src/lib/ChatScreens/AssetInput.svelte`                                                                                                            |
| Fastify mode detection               | Detects server-backed mode from the Fastify-injected browser marker and keeps non-Fastify compatibility paths alive.                                                                                                    | `src/ts/platform.ts`, `server/fastify/src/app.ts`                                                                                                                                                                      |
| Projection state                     | Holds a browser projection of server state, applies bootstrap data, hydrates heavy fields on demand, guards direct writes, and performs trusted projection updates when server events or commands arrive.               | `src/ts/bootstrap.ts`, `src/ts/storage/database.svelte.ts`, `src/ts/server/projection.ts`, `src/ts/server/projectionWriteGuard.svelte.ts`, `src/ts/server/chatMessageHydration.svelte.ts`                              |
| Server events                        | Subscribes to authenticated SSE and applies command/memory events with surgical hydration or full-bootstrap fallback.                                                                                                   | `src/ts/server/events.ts`, `src/ts/bootstrap.ts`                                                                                                                                                                       |
| Command adapters                     | Sends server commands, maps settings keys to command groups, applies optimistic local mutations, restores snapshots on failure, and serializes fan-out paths for chats/messages/modules/plugins.                        | `src/ts/server/commands.ts`, `src/ts/chatCommands.ts`, `src/ts/characterCommands.ts`, `src/ts/moduleCommands.ts`, `src/ts/pluginCommands.ts`                                                                           |
| Bridge watchers                      | Converts UI edits for settings, lorebooks, script definitions, and plugin storage into server commands while maintaining drafts/projections.                                                                            | `src/ts/server/settingsBridge.svelte.ts`, `src/ts/server/lorebookBridge.svelte.ts`, `src/ts/server/scriptDefinitionBridge.svelte.ts`, `src/ts/plugins/plugins.svelte.ts`                                               |
| Browser auth and storage adapters    | Creates short-lived browser assertion tokens, attaches active-writer headers, calls legacy storage APIs, and adapts asset reads/writes to Fastify routes.                                                               | `src/ts/storage/nodeStorage.ts`, `src/ts/globalApi.svelte.ts`, `src/ts/server/assets.ts`                                                                                                                               |
| Chat send orchestration              | Chooses server/local routing, manages abort state, sends `/api/v1/generate/chat`, consumes SSE frames, applies terminal patches, uploads browser-local inlay bytes, reattaches active jobs, and issues cancel requests. | `src/ts/process/index.svelte.ts`, `src/ts/process/serverBackedSendChat.ts`, `src/ts/process/request/serverChat.ts`, `src/ts/process/reattach.ts`                                                                       |
| Lower-level completion routing       | For auxiliary requests, builds client-side provider targets and calls either the server completion route or local provider dispatch depending on capability and mode.                                                   | `src/ts/process/request/request.ts`, `src/ts/process/request/serverCompletion.ts`, `src/ts/process/request/providerCapability.ts`                                                                                      |
| Local compatibility stack            | Keeps the full in-browser prompt assembler and provider dispatch for non-Fastify mode, tests, unsupported content, and the `useServerPromptAssembly=false` escape hatch.                                                | `src/ts/process/sendChatPromptAssembly.ts`, `src/ts/process/request/serverPromptAssembly.ts`, `src/ts/process/request/dispatchRequest.ts`                                                                              |
| Browser-only post-generation effects | Runs UI/audio/effect work that is not durable server mutation: notifications, TTS/display effects, emotion fallback, automatic image generation, and inlay rendering.                                                   | `src/ts/process/postGeneration/orchestrateResponse.ts`, `src/ts/process/postGeneration/runStage4.ts`, `src/ts/process/postGeneration/emotionFallbackEmbedding.ts`, `src/ts/process/postGeneration/imggenStableDiff.ts` |
| Plugins and local tools              | Hosts browser plugin runtime, blocks unsupported server-mode resource keys, reports Plugin V3 runtime capabilities, and runs MCP/local filesystem orchestration from the browser side.                                  | `src/ts/plugins/plugins.svelte.ts`, `src/ts/plugins/pluginSafeClass.ts`, `src/ts/plugins/apiV3/v3.svelte.ts`, `src/ts/process/mcp/*`                                                                                   |
| Local ML and legacy helpers          | Retains browser Hypa/memory helpers, embeddings, WebLLM, transformers, PDF/file helpers, and image-caption fallback code for non-server or unsupported paths.                                                           | `src/ts/process/memory/hypav3.ts`, `src/ts/process/memory/hypamemory.ts`, `src/ts/process/webllm.ts`, `src/ts/process/transformers.ts`, `src/ts/process/promptAssembly/formatHistoryMessage.ts`                        |
| Import/export UI glue                | Still contains browser `.risu` helpers, backup UI calls, module file import handling, and file/download affordances. Some Fastify-mode paths are blocked or routed to server APIs.                                      | `src/ts/storage/risuSave.ts`, `src/ts/storage/backup.ts`, `src/App.svelte`, `src/ts/server/backups.ts`, `src/ts/server/realmImport.ts`                                                                                 |

## Current Server Responsibilities

| Area                                    | Current server responsibility                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App boot and route wiring               | Builds the Fastify app, opens SQLite, starts workers/registries, runs message backfill, schedules asset GC, registers routes, and serves the built SPA with the Fastify marker.                                                                                   | `server/fastify/src/app.ts`, `server/fastify/src/index.ts`                                                                                                                                                                                                 |
| Auth and active writer                  | Stores password/public-key auth material, verifies assertion tokens, classifies mutating routes, and rejects stale writer sessions on server-owned mutations.                                                                                                     | `server/fastify/src/auth.ts`, `server/fastify/src/http.ts`, `server/fastify/src/activeWriter.ts`                                                                                                                                                           |
| Persistence and revisions               | Owns `db.json`, SQLite schema/versioning, global revisions, chat messages, per-chat `hypaV3Data`, reroll alternates, and memory tables.                                                                                                                           | `server/fastify/src/db.ts`, `server/fastify/src/repository.ts`, `server/fastify/src/messageStore.ts`                                                                                                                                                       |
| Bootstrap and projections               | Returns authenticated bootstrap state, masks provider secrets, stubs heavy projection fields, exposes asset base URL, lists active generation jobs, and hydrates targeted projection resources.                                                                   | `server/fastify/src/routes/bootstrap.ts`, `server/fastify/src/routes/projection.ts`, `server/fastify/src/providerSecrets.ts`                                                                                                                               |
| Command mutations                       | Validates and applies settings, presets, prompt items, personas, translators, loadouts, characters, chats, folders, script state, messages, generation results, lorebooks, modules, scripts/triggers, plugin storage, assets, and first-run state initialization. | `server/fastify/src/routes/commands.ts`, `server/fastify/src/commands/mutations.ts`, `server/fastify/src/commands/events.ts`                                                                                                                               |
| Prompt assembly                         | Builds the prompt on the server for supported sends, including input triggers, `editinput`, lore/history/memory selection, render sections, token budgeting, and prompt preview.                                                                                  | `server/fastify/src/prompt/assemble.ts`, `server/fastify/src/routes/generationChat.ts`                                                                                                                                                                     |
| Chat generation                         | Owns `/api/v1/generate/chat`, server-routable provider dispatch, SSE frames, durable generation jobs, reattach, cancel, post-generation derivation, generated message persistence, scriptstate persistence, and reroll alternates.                                | `server/fastify/src/routes/generationChat.ts`, `server/fastify/src/generationJobs.ts`, `server/fastify/src/prompt/chatDispatch.ts`, `server/fastify/src/prompt/providerTransport.ts`                                                                       |
| Generic completion                      | Provides lower-level completion routing for server-routable providers and streaming/non-streaming provider adapters.                                                                                                                                              | `server/fastify/src/routes/generation.ts`, `server/fastify/src/generation/*`                                                                                                                                                                               |
| Hypa V3 memory                          | Persists memory data, plans jobs, chunks/summarizes/embeds, retries/cancels jobs, emits progress, and selects prompt-time memory.                                                                                                                                 | `server/fastify/src/memoryRepository.ts`, `server/fastify/src/memoryWorker.ts`, `server/fastify/src/memoryPlanner.ts`, `server/fastify/src/routes/memoryJobs.ts`, `server/fastify/src/routes/memoryReads.ts`, `server/fastify/src/prompt/memoryAdapter.ts` |
| Assets                                  | Stores content-addressed assets, serves immutable bytes, probes existence, emits asset events, tracks revisions, and garbage-collects unreferenced assets.                                                                                                        | `server/fastify/src/routes/assets.ts`, `server/fastify/src/assetGc.ts`                                                                                                                                                                                     |
| Import/export and backups               | Imports/exports `.risu`, builds export bundles, imports Realm/charx data and assets, and creates/lists/restores/deletes backups covering JSON, SQLite, assets, and legacy save data.                                                                              | `server/fastify/src/routes/save.ts`, `server/fastify/src/risuSave/*`, `server/fastify/src/routes/realmImport.ts`, `server/fastify/src/routes/backups.ts`                                                                                                   |
| Events                                  | Emits authenticated command and memory SSE events used by the browser projection.                                                                                                                                                                                 | `server/fastify/src/routes/events.ts`, `server/fastify/src/memoryEvents.ts`                                                                                                                                                                                |
| Proxy, hub, stream jobs, legacy storage | Owns authenticated fetch proxying, local/private stream jobs, Hub proxying, and legacy byte storage APIs under `data/save`.                                                                                                                                       | `server/fastify/src/routes/proxy.ts`, `server/fastify/src/streamJobs.ts`, `server/fastify/src/routes/streamJobs.ts`, `server/fastify/src/routes/hub.ts`, `server/fastify/src/routes/legacyStorage.ts`                                                      |

## Already Moved To The Server

- Fastify mode no longer persists the main database through browser `saveDb()`;
  `saveDb()` returns early and the server command/projection path owns durable
  state.
- Supported chat sends use server prompt assembly and `/api/v1/generate/chat` by
  default because `useServerPromptAssembly` defaults to `true`.
- Server-side prompt assembly now covers the core A-path work: input trigger,
  `editinput`, lore/history/memory/render sections, token budgeting, output
  trigger, `editoutput`, run vars, scriptstate derivation, and final assistant
  text.
- Server `/chat` persists generation results and scriptstate through the
  command/mutation path instead of relying on browser-local DB saves.
- DevTool scriptstate editing now commits variable changes through the chat
  scriptstate command helper; the variable editor no longer binds form inputs
  directly into the server projection.
- DevTool Autopilot now appends each user row through the current-chat message
  command helper before calling `sendChat(i)`; the run button no longer mutates
  `currentChat.message` or calls `setDatabase(db)` directly.
- Chat messages, Hypa V3 data, and reroll alternates are split into SQLite and
  hydrated back into the browser projection only when needed.
- Assets, backups, Realm import, `.risu` import/export, memory jobs, proxying,
  and legacy storage all have Fastify routes with browser adapters.
- Unsafe direct resource writes from browser plugins are blocked in server mode
  unless a supported bridge command exists.
- First-run/default initialization is server-owned: a fresh Fastify database is
  initialized by `POST /api/v1/commands/state/initialize` without accepting a
  browser-provided database payload, server import/default normalization fills the
  durable default shape, and Fastify projections enter the browser without
  `setDatabase()` default shaping.

## Server-Owned Items Still In The Client

### P2: Client still builds provider wire payloads for server completion

For lower-level completion requests, the browser still resolves model/provider
targets, builds options, and includes API-key-bearing payload shapes before
calling server completion. The server owns provider transport and secret masking
for durable chat generation, so this remains a server-shaped responsibility to
thin if the goal is to centralize provider policy fully.

Evidence:

- `src/ts/process/request/serverCompletion.ts`
- `src/ts/process/request/request.ts`
- `server/fastify/src/routes/generation.ts`

### P2: Inlay bytes remain browser-local

Server-backed generation receives inlay assets from the browser as base64 request
inputs because the durable copy still lives in browser local storage. This is
acceptable as request-time input, but it means the server does not fully own all
generation-adjacent assets yet.

Evidence:

- `src/ts/process/serverBackedSendChat.ts`
- `src/ts/process/files/inlays.ts`

### P2: Local prompt assembly/provider dispatch remains as an escape hatch

`resolveServerPromptAssembly()` still returns `local` in non-Fastify mode and
when `useServerPromptAssembly=false`. The default is server assembly, and
unsupported content hard-fails instead of silently falling back, so this is a
closeout item rather than an active split-brain path.

Evidence:

- `src/ts/process/request/serverPromptAssembly.ts:200`
- `src/ts/process/sendChatPromptAssembly.ts`
- `src/ts/storage/database.svelte.ts:774`
- `docs/leftover.md`

### P3: `.risu` codec/browser file glue is duplicated

The server owns `.risu` import/export routes, but client-side `.risu` helper code
still exists for browser file/download flows and local compatibility. This is
reasonable UI glue today, but it is still duplicated codec surface that should be
watched when import/export behavior changes.

Evidence:

- `src/ts/storage/risuSave.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/risuSave/*`

### P3: Module file import is blocked in Fastify mode

The top-level drag/drop import path rejects `.risum` module file import when the
browser is server-backed. If this feature returns in Fastify mode, validation and
persistence should be added as a server command/import route instead of reviving
a client-side durable mutation.

Evidence:

- `src/App.svelte`
- `src/ts/moduleCommands.ts`
- `server/fastify/src/routes/commands.ts`

## Client Responsibilities That Are Not Server Gaps

- Visual UI, routing, modals, chat rendering, controls, selection state, and
  optimistic feedback are client responsibilities.
- Browser post-generation effects such as TTS, notifications, image generation
  UI, emotion fallback, and inlay rendering are intentionally client-side effects
  unless a future product decision makes them durable server work.
- Plugin runtime execution remains client-only by policy. Plugin V2 edit hooks
  are explicitly unsupported for server prompt assembly rather than silently
  ported.
- Interactive browser Lua dialogs are unsupported for server assembly because the
  server cannot drive a browser dialog mid-assembly.
- Non-vision image-caption fallback is browser-only ML. Fastify mode hard-fails
  that content class instead of producing a silently captionless server prompt.
- The Hypa V3 modal and memory UI can remain client UI even though memory
  persistence/jobs/selection are server-owned.
- `src/ts/server/*` should remain a client adapter layer. Its existence is not
  evidence that server responsibilities are implemented in the browser by itself.

## Verification Notes

- Ran `pnpm exec vitest run src/ts/server/commands.test.ts src/ts/bootstrap.test.ts`.
- Ran `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/projection.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/risuSaveCodec.test.ts`.
- Ran `pnpm check`.
- Ran `pnpm client-thinning:audit`.
- Ran `pnpm api:test`; all API tests passed except the existing large Realm charx
  import test in `server/fastify/__tests__/realmImport.test.ts`, which timed out
  at 30000 ms.
