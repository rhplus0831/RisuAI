# Backend Map

The backend is a Fastify server under `server/fastify`. It owns persistence,
provider secrets, prompt assembly, server-side generation, Hypa V3 memory, and
the route surface consumed by the Svelte client.

## Entrypoints And App Factory

- `server/fastify/src/index.ts` calls `buildApp()` and listens on the configured
  host and port.
- `server/fastify/src/app.ts` is the central composition point. It creates the
  Fastify instance, registers Fastify plugins, opens SQLite, creates event buses,
  starts the memory worker, creates auth state, registers all routes, and
  optionally serves the built SPA.
- `server/fastify/src/config.ts` loads most server env vars:
  `RISU_API_HOST`, `RISU_API_PORT`, `RISU_API_DATA_DIR`,
  `RISU_API_BODY_LIMIT`, `TRUST_PROXY`, `RISU_API_STATIC_ROOT`, and
  `RISU_HUB_URL`. `LOG_LEVEL` is read directly in `server/fastify/src/app.ts`.

The app factory is test-friendly: many pieces are injectable through
`BuildAppOptions`, including generation chat dispatch, memory worker behavior,
memory event sinks, and command event sinks.

## Route Registration

Route modules export `registerXRoutes(app, ...)` and register concrete
`/api/v1/...` paths directly. The registration order is centralized in
`server/fastify/src/app.ts`.

| Family             | Registrar                  | Notes                                                       |
| ------------------ | -------------------------- | ----------------------------------------------------------- |
| Health             | `routes/health.ts`         | Public health and schema revision surface.                  |
| Auth               | `routes/auth.ts`           | Password setup, login, auth status.                         |
| Bootstrap          | `routes/bootstrap.ts`      | Returns current projection and revision.                    |
| Save/import/export | `routes/save.ts`           | `.risu` import/export and bundle export.                    |
| Commands           | `routes/commands.ts`       | Large command registrar for settings and domain mutations.  |
| Events             | `routes/events.ts`         | SSE stream for command and memory events.                   |
| Assets             | `routes/assets.ts`         | Upload and read content-addressed assets.                   |
| Backups            | `routes/backups.ts`        | Create/list/restore/delete persisted snapshots.             |
| Proxy              | `routes/proxy.ts`          | Authenticated generic fetch proxy with binary parser scope. |
| Stream jobs        | `routes/streamJobs.ts`     | HTTP job creation plus WebSocket attachment.                |
| Hub                | `routes/hub.ts`            | Retained hub passthrough, despite legacy naming elsewhere.  |
| Legacy storage     | `routes/legacyStorage.ts`  | Active `/api/v1/storage/*` bridge for client `NodeStorage`. |
| Generation         | `routes/generation.ts`     | Completion route and provider request validation.           |
| Chat generation    | `routes/generationChat.ts` | Prompt assembly SSE + provider dispatch + post-gen pass; also the durable-generation reattach (`GET .../:id/stream`) and cancel (`DELETE .../:id`) routes. |
| Memory jobs        | `routes/memoryJobs.ts`     | Queue/cancel/list memory jobs.                              |
| Memory reads       | `routes/memoryReads.ts`    | Read chunks and summaries.                                  |

Most route handlers call `requireAuth(authState, req, reply)` manually. There is
no global auth middleware. Public routes are intentional and include health,
auth status/setup/login, some asset reads/existence checks, and auth crypto.

## Commands

`server/fastify/src/routes/commands.ts` is intentionally large because it owns
the route surface for many resources. The resource-specific validation and shape
logic is split into `server/fastify/src/commands/`.

Common command rules:

- Request bodies include `baseRevision`.
- Mutations should use `applyJsonCommandMutation`.
- Conflicts return 409 when the client revision is stale.
- Successful command mutations bump the revision once and emit one command event.
- Public command APIs should use stable ids, not array indexes.

Browser-side command wrappers live in `src/ts/server/commands.ts` plus narrower
helpers such as `src/ts/characterCommands.ts`, `src/ts/chatCommands.ts`,
`src/ts/moduleCommands.ts`, and `src/ts/pluginCommands.ts`.

## Generation Path

`POST /api/v1/generate/chat` is registered in `routes/generationChat.ts`. In the
default Fastify flow the **server owns prompt assembly and the provider call**. The
browser classifies each send with `resolveServerPromptAssembly` + the shared
`resolveProviderCapability` table (`src/ts/process/request/`) and POSTs raw inputs;
unsupported shapes hard-fail rather than silently falling back to local assembly.

High-level flow (non-durable / inline path, `streamAssembly`):

1. Validate route body and auth.
2. Attach an abort signal to the request close event (inline path only — see durable
   path below, which detaches instead).
3. Load the persisted database with chat messages joined from SQLite.
4. Call `prompt/assemble.ts`. Assembly runs the server **Lua VM**
   (`prompt/luaRuntime.ts`) for non-interactive `editRequest` / `editprocess` /
   input-trigger / `editinput` hooks, and persists the assembly-time scriptstate
   delta to `data/db.json` itself (C-A1).
5. Emit SSE stage, prompt, `message_patch`, info, warning, token, error, and done frames.
6. Dispatch the provider call through `prompt/chatDispatch.ts`.
7. Convert provider frames to chat SSE in `prompt/providerTransport.ts`.
8. After dispatch, run the **A2 post-generation pass** (`runServerPostGeneration` in
   `prompt/assemble.ts`): the run-var pass, the `'output'` trigger, and `editoutput`.
   The derived scriptstate delta is persisted and the final text / resend / revision
   ride on `done.postGeneration`. A thrown post-gen pass is best-effort-swallowed on
   the inline path (no frame, no browser fallback — a code TODO marks this).

Provider-specific adapters live in `server/fastify/src/generation/`. Prompt
assembly helpers live in `server/fastify/src/prompt/` and cover history,
lorebook, static/plain sections, modules, scripts, triggers, tokenizer config,
memory adapters, the server Lua VM, and budget finalization.

### Durable Generation (survive client disconnect)

A generating request the browser classifies durable (`resolveDurableGeneration === 'durable'` →
`body.durable === true`, `send` / `continue` / `regenerate`) does **not** run inline.
Instead the route hands off to a detached job so the generation survives the browser disconnecting:

- The job runs in `GenerationJobRegistry` (`generationJobs.ts`, wired + GC-ticked in
  `app.ts`), which wraps the proxy's reconnectable `streamJobs.ts` `JobRegistry` with a
  transient `chatId → jobId` submission lock (**one running job per chat**, `409` on a
  second) and the `activeGenerationJobs` bootstrap projection.
- The request connection is a detachable **viewer**: a disconnect calls `detach`
  (the job keeps running and buffers its SSE frames), **not** `abort`. The first frame
  is `job_accepted` carrying the `jobId`, sent before assembly.
- At completion the job runs the same A2 post-generation pass and **persists the
  derived assistant message + scriptstate delta itself** (one `applyJsonCommandMutation`,
  `generation.persisted` event, idempotent on `generationId`) — so the result is durable
  with no browser command-replay. Failure policy: derivation throw → persist raw +
  `warning`; persist throw (chat gone) → job `error`.
- `GET /api/v1/generate/chat/:id/stream` reattaches (read-only observe, open to any
  authed client). `DELETE /api/v1/generate/chat/:id` cancels (authorized by the current
  active writer; the browser stop button calls it — a bare disconnect does not cancel).
- Bootstrap surfaces `activeGenerationJobs`; the browser consumes it and auto-reattaches
  to an open chat's in-flight job after reload / reconnect.
- In-memory only: jobs are lost on a server restart. Design records:
  [`../archive/durable-generation/`](../archive/durable-generation/README.md) and
  [`../archive/lazy-projection/`](../archive/lazy-projection/README.md).

## Memory System

Only Hypa V3 is maintained. Memory storage and jobs are server-side.

Important files:

- `server/fastify/src/db.ts` creates SQLite schema and memory tables.
- `server/fastify/src/memoryRepository.ts` reads and writes chunks, summaries,
  embeddings, and jobs.
- `server/fastify/src/memoryWorker.ts` claims queued jobs, retries failures, and
  emits memory events.
- `server/fastify/src/memoryPlanner.ts` and `memoryChunkPlanner.ts` plan chunk
  creation and memory windows.
- `server/fastify/src/memoryEmbedJobHandler.ts` and
  `memorySummarizeJobHandler.ts` execute job work.
- `server/fastify/src/routes/memoryJobs.ts` and `routes/memoryReads.ts` expose
  memory APIs.

The worker starts in `buildApp()` unless disabled through test options, and it
is stopped in the app `onClose` hook.

## Static SPA Serving

If `RISU_API_STATIC_ROOT` resolves to an existing directory, `buildApp()`
registers `@fastify/static`, serves `/`, and falls back to the SPA shell for
non-API GETs. It injects `globalThis.__FASTIFY__ = true` into `index.html` so
the browser can switch into Fastify-backed mode.

Set `RISU_API_STATIC_ROOT=off`, `none`, or an empty string to disable static SPA
serving.
