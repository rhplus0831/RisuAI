# Implementation Map

Date: 2026-05-30

Read this after [`status.md`](status.md) and before editing code. It maps the
implementation to files, contracts, and proof points. For the Phase 4
chat-process batches, [`reference/`](reference/README.md) is the deeper,
per-work-item routing (exact signatures, parity matrix, persistence round-trip,
proof points).

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
  `src/ts/process/request/serverPromptAssembly.ts::resolveServerPromptAssembly`
  decides `local | server | unsupported`. `local` is reached when
  `!isFastifyServer` or the default-off `useServerPromptAssembly` gate is off.
  With the flag on, the text-send subset and image-input multimodal/asset sends
  route to `/api/v1/generate/chat`; non-interactive Lua edit/input hooks run
  server-side; the image-gen instruction is server-assembled; unsupported
  content hard-fails. PluginV2, interactive Lua dialogs, and non-vision image
  caption fallback are explicit unsupported.
- **Post-generation + persistence (server-owned on the server-dispatch path):**
  `server/fastify/src/prompt/assemble.ts::runServerPostGeneration` and
  `server/fastify/src/routes/generationChat.ts::buildPostGenerationFrame` run
  the run-var pass, `runTrigger(..., 'output', ...)`, and `editoutput` after
  dispatch. The route persists the derived scriptstate delta via the slice-2
  writer and returns final text / resend / revision on `done.postGeneration`.
  `src/ts/process/postGeneration/orchestrateResponse.ts` skips browser
  `editoutput` + output-trigger derivation when `serverOwnsPostGeneration` is
  true; B1 effects and B2 final-message persistence remain browser-orchestrated.
- **HypaV3 memory:** server-side persistence/jobs under
  `server/fastify/src/routes/memory*.ts`; progress UI is a transient browser
  projection.

**Legacy — group chat:** Fastify data loading filters group characters and
dispatch hardcodes `isGroupChat: false`; `chatProcessIndex` is reentrancy/
preset-chain state, not the group surface. Remaining UI/type compatibility is
slated for client removal as a separate task — see
[`unsupported-and-client-owned.md`](unsupported-and-client-owned.md).

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
| Prompt assembly (A1) | `serverPromptAssembly.ts`, `serverChat.ts`, `routes/generationChat.ts`, `prompt/` | `serverPromptAssembly.test.ts`, `generation.chat.test.ts`, serverBacked fixtures |
| Chat-process thinning | `index.svelte.ts`, `serverBackedSendChat.ts`, `postGeneration/` | serverBacked/serverPreview fixtures, projection-guard tests |
| Audit invariants | `util/client-thinning-audit.ts` | `pnpm client-thinning:audit`; audit fixture tests |

## Scope Checklist (before changing behavior)

Invariant · owner · timing · input context · allowed mutations · persistence shape
· error shape · projection behavior · proof. For closeout, keep group-chat
removal, audit-rule hardening, event-patching, and docs-only reconciliation in
separate batches.

## Focused Verification

- Audit: `pnpm client-thinning:audit`
- Server: `pnpm api:test -- commands` / `activeWriter` / `assets` / `backups` / `bootstrap events`
- Chat process: `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/request/tests/serverCompletion.test.ts`
- Full: `pnpm api:test`, `pnpm test`, `pnpm smoke:fastify-browser`

After a recordable verification, replace
[`coverage/latest-verification.md`](coverage/latest-verification.md) with only the
latest command and result.
