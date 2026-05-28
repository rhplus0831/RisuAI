# Status Overview

Date: 2026-05-28

Read this when starting a client-thinning task, checking phase language, or
finding canonical code entry points.

## Current Status

- Fastify-served web mode is projection-backed: bootstrap projection,
  command-backed writes, command/memory events, and projection guard are
  implemented.
- The old Fastify Phase 9 milestone is archived. This folder tracks remaining
  client-thinning work as a standalone major task.
- `pnpm client-thinning:audit` is the main invariant audit, but fixture
  reproducibility is open.
- Server provider dispatch is the Fastify generation boundary for supported
  providers. Unsupported provider shapes fail explicitly.
- Server prompt assembly is not default-thin: `sendChat` still has local prompt
  assembly fallback unless `useServerPromptAssembly` is true.
- Default chat-screen submission still has browser-side user-row creation,
  input trigger/editinput execution, message replacement, reroll trimming, and
  abort setup before `sendChat`.
- Event handling remains invalidation-based. Command events cause projection
  refresh; they are not surgical patch contracts.

## Phase Language

- Phase 0 extraction: active for this docs split, then complete.
- Phase 1 baseline contract: mostly complete; update only when source inventory
  changes the invariant.
- Phase 2 audit reproducibility: active and first priority.
- Phase 3 command/projection hardening: active only for one invariant family at
  a time.
- Phase 4 sendChat thinning: active only when a batch names one prompt or
  post-generation branch and matching server proof.
- Phase 5 closeout: blocked until audit reproducibility and latest verification
  are current.

## Code Entry Points

Server:

- `server/fastify/src/app.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/activeWriter.ts`
- `server/fastify/src/routes/events.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/backups.ts`
- `server/fastify/src/routes/generation.ts`
- `server/fastify/src/routes/generationChat.ts`

Frontend:

- `src/ts/bootstrap.ts`
- `src/ts/server/bootstrap.ts`
- `src/ts/server/commands.ts`
- `src/ts/server/events.ts`
- `src/ts/server/projectionWriteGuard.svelte.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/process/index.svelte.ts`
- `src/ts/process/serverBackedSendChat.ts`
- `src/ts/process/sendChatPromptAssembly.ts`
- `src/ts/process/postGeneration/`
- `src/ts/process/request/serverCompletion.ts`
- `src/ts/process/request/serverChat.ts`

Audit:

- `util/client-thinning-audit.ts`
