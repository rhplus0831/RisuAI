# Implementation Map

Date: 2026-05-28

Read this after [`status.md`](status.md) and before editing code. It maps the
current client-thinning implementation to the files, invariants, and proof
points task agents usually need.

## Projection Path

1. `server/fastify/src/app.ts` registers routes and injects
   `globalThis.__FASTIFY__ = true` into the served SPA shell.
2. `src/main.ts` calls `loadData()`, which reaches `src/ts/bootstrap.ts`.
3. `src/ts/server/bootstrap.ts::fetchServerBootstrapProjection()` requests
   `/api/v1/bootstrap` as writer-intent bootstrap.
4. `server/fastify/src/routes/bootstrap.ts` authenticates, optionally registers
   active-writer ownership, loads persisted state, masks provider secrets, and
   returns the projection plus revision.
5. `src/ts/storage/database.svelte.ts::applyServerProjectionDatabase()` applies
   the projection through `withTrustedServerProjectionWrite()`.
6. `src/ts/server/projectionWriteGuard.svelte.ts` freezes ordinary projection
   writes in Fastify mode.
7. `src/ts/server/events.ts::subscribeServerCommandEvents()` consumes
   `/api/v1/events`; command events schedule projection refreshes.

## Command Path

1. UI or domain code calls a typed helper in `src/ts/server/commands.ts` or a
   narrower helper such as `src/ts/chatCommands.ts`,
   `src/ts/characterCommands.ts`, `src/ts/moduleCommands.ts`, or
   `src/ts/pluginCommands.ts`.
2. `runServerCommand()` reads the cached/bootstrap revision and invokes the
   command callback.
3. `requestCommandJson()` posts to `/api/v1/commands/*` with `risu-auth`,
   active-writer header, and `baseRevision`.
4. `server/fastify/src/routes/commands.ts` validates auth, reads
   `baseRevision`, calls a resource-specific command helper, and routes the
   mutation through `applyJsonCommandMutation()`.
5. `server/fastify/src/commands/mutations.ts` checks revision, writes
   persisted JSON transactionally, bumps SQLite revision, emits one command
   event, and rolls back on failure.

## Generation And Memory Path

- Provider dispatch in Fastify mode is selected by
  `src/ts/process/request/serverCompletion.ts::resolveServerCompletionRoute`.
  Supported providers post to `/api/v1/generate/completion`; unsupported
  provider shapes fail explicitly.
- Prompt assembly can route through `/api/v1/generate/chat` via
  `src/ts/process/request/serverChat.ts`, but production `sendChat` only uses
  that path when `DBState.db.useServerPromptAssembly` is true.
- `server/fastify/src/routes/generationChat.ts` validates chat intent, assembles
  prompts, emits SSE frames, and optionally dispatches the provider.
- Hypa V3 memory state lives server-side in SQLite and memory routes under
  `server/fastify/src/routes/memory*.ts`.

## Chat Submission Path

Default chat-screen submission still has several browser-owned or partially
thin responsibilities:

1. `src/lib/ChatScreens/DefaultChatScreen.svelte::sendMain` handles slash
   commands, file-inlay token text, say-nothing user rows, input triggers,
   editinput scripts, message replacement, reroll trimming, abort setup, and
   the call into `sendChat`.
2. `src/ts/process/index.svelte.ts::sendChat` owns the busy lock, send context,
   server-assembly gate, local prompt fallback, provider dispatch handoff,
   response orchestration, recursive continue/resend, stage 4, and final
   persistence.
3. `src/ts/process/sendChatPromptAssembly.ts` remains the local prompt assembly
   fallback.
4. `src/ts/process/serverBackedSendChat.ts` maps the server-backed mode,
   applies server message/scriptstate patches, handles terminal side effects,
   and currently persists the final generation result through browser command
   replay.
5. `src/ts/process/postGeneration/orchestrateResponse.ts` and
   `src/ts/process/postGeneration/runStage4.ts` own browser-side closeout
   branches such as notification, emotion fallback, image generation, resend,
   and final stage metadata.

Valid sendChat thinning work should name one of those branches, the server
replacement contract, and the proof that the browser branch can shrink.

## Audit Map

`util/client-thinning-audit.ts` currently checks:

- passive bootstrap refresh must not register active writer ownership
- conflict replay is forbidden outside the central command wrapper
- command routes must not transitively mint durable ids from request payloads
- globally addressed resolvers normalize before mutation
- asset walker and validators stay in parity
- masked wildcard secrets restore by stable identity
- asset URL helpers gate to documented shapes
- composite command fan-out is serialized
- backup/restore covers every known data directory child
- process-lifetime accumulators are bounded or classified
- `saveAsset` callers declare filename or image-default classification

## Ownership Map

| Concern                       | Primary files                                                                                                                                                | Typical proof                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Bootstrap projection          | `server/fastify/src/routes/bootstrap.ts`, `src/ts/server/bootstrap.ts`, `src/ts/bootstrap.ts`                                                                | `server/fastify/__tests__/bootstrap.test.ts`, `src/ts/server/bootstrap.test.ts`, `src/ts/bootstrap.test.ts` |
| Projection write guard        | `src/ts/server/projectionWriteGuard.svelte.ts`, `src/ts/storage/database.svelte.ts`                                                                          | `src/ts/**/*.projectionGuard.test.ts`, `pnpm client-thinning:audit`                                         |
| Command route contract        | `server/fastify/src/routes/commands.ts`, `server/fastify/src/commands/*.ts`, `src/ts/server/commands.ts`                                                     | `server/fastify/__tests__/commands.test.ts`, `src/ts/server/commands.test.ts`                               |
| Active writer                 | `server/fastify/src/activeWriter.ts`, `src/ts/server/activeWriterSession.ts`                                                                                 | `server/fastify/__tests__/activeWriter.test.ts`                                                             |
| Events and projection refresh | `server/fastify/src/routes/events.ts`, `server/fastify/src/commands/events.ts`, `src/ts/server/events.ts`                                                    | `server/fastify/__tests__/events.test.ts`, `src/ts/server/events.test.ts`                                   |
| Assets                        | `server/fastify/src/routes/assets.ts`, `server/fastify/src/commands/assets.ts`, `src/ts/server/assets.ts`, `src/ts/globalApi.svelte.ts`                      | `server/fastify/__tests__/assets.test.ts`, `src/ts/server/assets.test.ts`                                   |
| Import/export/bundle          | `server/fastify/src/routes/save.ts`, `server/fastify/src/risuSave/`, `src/ts/storage/risuSave.ts`                                                            | `server/fastify/__tests__/risuSave*.test.ts`, `src/ts/storage/risuSave.test.ts`                             |
| Backup/restore                | `server/fastify/src/repository.ts`, `server/fastify/src/routes/backups.ts`, `src/ts/server/backups.ts`                                                       | `server/fastify/__tests__/backups.test.ts`, `src/ts/server/backups.test.ts`                                 |
| Provider routing              | `src/ts/process/request/serverCompletion.ts`, `server/fastify/src/routes/generation.ts`, `server/fastify/src/generation/`                                    | `src/ts/process/request/tests/serverCompletion.test.ts`, provider tests under `server/fastify/__tests__`    |
| Server prompt assembly        | `src/ts/process/request/serverChat.ts`, `server/fastify/src/routes/generationChat.ts`, `server/fastify/src/prompt/`                                          | `server/fastify/__tests__/generation.chat.test.ts`, server-backed sendChat fixture tests                    |
| sendChat browser thinning     | `src/lib/ChatScreens/DefaultChatScreen.svelte`, `src/ts/process/index.svelte.ts`, `src/ts/process/serverBackedSendChat.ts`, `src/ts/process/postGeneration/` | server-backed sendChat fixtures, generation chat route tests, command/projection guard tests                |
| Audit invariants              | `util/client-thinning-audit.ts`                                                                                                                              | `pnpm client-thinning:audit`; audit fixture tests                                                           |

## Scope Of Work Checklist

Before changing behavior, write a short scope:

- Invariant: which client-thinning rule is being protected or widened.
- Owner: browser projection, command route, Fastify route, repository, provider
  dispatcher, memory route, or explicitly client-owned/no-port.
- Timing: bootstrap, command mutation, event refresh, import/export, asset
  upload/read, generation validate, prompt assembly, provider dispatch,
  post-generation, memory job, backup/restore, or display-only.
- Input context: request body, revision, active-writer session, selected ids,
  asset ids, provider settings, prompt rows, memory job ids, or plugin keys.
- Allowed mutations: domain JSON, assets, SQLite, legacy storage, command event,
  memory event, browser projection, or nothing.
- Persistence shape: created/updated/deleted/restored rows and rollback path.
- Error shape: 400, 401/403, 404, 409, 423, explicit unsupported error,
  warning-only, SSE error, or local UI notification.
- Projection behavior: whether a command event, bootstrap refresh, or trusted
  projection write is expected.
- Coverage: smallest audit, route, command-helper, projection-guard, provider,
  smoke, or fixture test that would fail if the behavior drifted.

## Focused Verification

- Audit: `pnpm client-thinning:audit`
- Server commands/routes: `pnpm api:test -- commands`
- Active writer: `pnpm api:test -- activeWriter`
- Assets: `pnpm api:test -- assets`
- Backups: `pnpm api:test -- backups`
- Bootstrap/events: `pnpm api:test -- bootstrap events`
- Browser command helpers: `pnpm test -- src/ts/server/commands.test.ts`
- Projection guard: `pnpm test -- src/ts/process/__tests__/command.projectionGuard.test.ts`
- Full server check: `pnpm api:test`
- Full browser/domain check: `pnpm test`
- Smoke: `pnpm smoke:fastify-browser`

After running a verification that should be recorded, replace
[`coverage/latest-verification.md`](coverage/latest-verification.md) with only
the latest command and result.
