# Implementation Map

Date: 2026-05-29

Read this after [`status.md`](status.md) and before editing code. It maps the
implementation to files, contracts, and proof points.

## Projection Path

1. `server/fastify/src/app.ts` registers routes and injects
   `globalThis.__FASTIFY__ = true` into the served SPA.
2. `src/main.ts` → `loadData()` → `src/ts/bootstrap.ts`.
3. `src/ts/server/bootstrap.ts::fetchServerBootstrapProjection()` requests
   `/api/v1/bootstrap` (writer-intent).
4. `server/fastify/src/routes/bootstrap.ts` authenticates, optionally registers
   active-writer ownership, masks secrets, returns projection + revision.
5. `src/ts/storage/database.svelte.ts::applyServerProjectionDatabase()` applies it
   through `withTrustedServerProjectionWrite()`.
6. `src/ts/server/projectionWriteGuard.svelte.ts` freezes ordinary writes.
7. `src/ts/server/events.ts` consumes `/api/v1/events`; command events schedule a
   debounced read-only refresh (invalidation, not patches).

## Command Path

1. UI/domain code calls a helper in `src/ts/server/commands.ts` (or a narrower
   helper such as `src/ts/chatCommands.ts`).
2. `runServerCommand()` reads the cached/bootstrap revision and invokes the
   callback; `requestCommandJson()` POSTs to `/api/v1/commands/*` with auth,
   active-writer header, and `baseRevision`.
3. `server/fastify/src/routes/commands.ts` validates, calls a resource helper, and
   routes through `applyJsonCommandMutation()`.
4. `server/fastify/src/commands/mutations.ts` checks revision, writes JSON, bumps
   revision once, emits one event, rolls back on failure.

## Generation And Chat-Process Path

Three boundaries (see [`status/sendchat-thinning.md`](status/sendchat-thinning.md)):

- **Provider dispatch (server, platform-gated, no flag):**
  `src/ts/process/request/serverCompletion.ts::resolveServerCompletionRoute`
  returns `local | server | unsupported`; `local` only when `!isFastifyServer`;
  supported → `/api/v1/generate/completion`; unsupported → hard fail. This is the
  precedent to mirror for prompt assembly.
- **Prompt assembly (browser by default):**
  `src/ts/process/index.svelte.ts::sendChat` gates on
  `isFastifyServer && DBState.db.useServerPromptAssembly` (default false →
  `assembleLocalSendChatPrompt`). The server path is
  `src/ts/process/request/serverChat.ts` → `/api/v1/generate/chat` →
  `server/fastify/src/prompt/assemble.ts`. **Blocker A1:** no
  `resolveServerPromptAssembly` classifier exists; server lacks content parity
  (multimodal `prompt/history.ts` `NO_ASSETS` + unused `inlayAssets`, image-gen
  instruction, Lua `editRequest` identity, Lua/plugin-V2 + input scripts).
- **Post-generation + persistence (browser):**
  `src/ts/process/postGeneration/{orchestrateResponse,runStage4}.ts`. **Blocker
  A2:** the output trigger has no server path
  (`server/fastify/src/prompt/triggers.ts` wires only `'start'`), and `editoutput`
  is browser-only. `server/fastify/src/routes/generationChat.ts` is stateless re
  the chat blob — it emits a `message_patch` the browser replays as commands
  (`src/ts/process/serverBackedSendChat.ts` →
  `dispatchPatchChatScriptstate`/`dispatchPersistGenerationResult`). The **C-A1**
  batch moves assembly-time scriptstate persistence into the route.
- **HypaV3 memory:** server-side persistence/jobs under
  `server/fastify/src/routes/memory*.ts`; progress UI is a transient browser
  projection.

**Legacy — group chat:** the `chatProcessIndex` recursion in `sendChat`, the
`isGroupChat` flag (`src/ts/process/request/request.ts` type;
`src/ts/process/dispatch/dispatchRequest.ts` hardcoded `false`), and group
character/message-type handling (`src/ts/util.ts`). Slated for client removal as a
separate task — see [`unsupported-and-client-owned.md`](unsupported-and-client-owned.md).

## Runtime Gates

- `isFastifyServer` (`src/ts/platform.ts`): runtime seam from `__FASTIFY__`; false
  under `pnpm dev`/web(dev) and tests. Not deprecated; annotated in-code.
- `useServerPromptAssembly` (`src/ts/storage/database.svelte.ts` default + JSDoc):
  incomplete-migration gate, default off. Not deprecated; annotated in-code.
- `useServerGeneration`: removed 2026-05-29 (was dead).

## Ownership Map

| Concern | Primary files | Typical proof |
| --- | --- | --- |
| Bootstrap projection | `routes/bootstrap.ts`, `src/ts/server/bootstrap.ts` | `bootstrap.test.ts` |
| Projection write guard | `projectionWriteGuard.svelte.ts`, `database.svelte.ts` | `*.projectionGuard.test.ts`, audit |
| Command route contract | `routes/commands.ts`, `commands/*.ts`, `src/ts/server/commands.ts` | `commands.test.ts` |
| Active writer | `activeWriter.ts`, `src/ts/server/activeWriterSession.ts` | `activeWriter.test.ts` |
| Events / refresh | `routes/events.ts`, `src/ts/server/events.ts` | `events.test.ts` |
| Provider routing | `serverCompletion.ts`, `routes/generation.ts` | `serverCompletion.test.ts` |
| Prompt assembly (A1) | `serverChat.ts`, `routes/generationChat.ts`, `prompt/` | `generation.chat.test.ts`, serverBacked fixtures |
| Chat-process thinning | `index.svelte.ts`, `serverBackedSendChat.ts`, `postGeneration/` | serverBacked/serverPreview fixtures, projection-guard tests |
| Audit invariants | `util/client-thinning-audit.ts` | `pnpm client-thinning:audit`; audit fixture tests |

## Scope Checklist (before changing behavior)

Invariant · owner · timing · input context · allowed mutations · persistence shape
· error shape · projection behavior · proof. Name one blocker item; do not mix A1
content classes, A2, and group-chat removal.

## Focused Verification

- Audit: `pnpm client-thinning:audit`
- Server: `pnpm api:test -- commands` / `activeWriter` / `assets` / `backups` / `bootstrap events`
- Chat process: `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/request/tests/serverCompletion.test.ts`
- Full: `pnpm api:test`, `pnpm test`, `pnpm smoke:fastify-browser`

After a recordable verification, replace
[`coverage/latest-verification.md`](coverage/latest-verification.md) with only the
latest command and result.
