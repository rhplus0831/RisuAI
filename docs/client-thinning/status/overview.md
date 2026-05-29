# Status Overview

Date: 2026-05-30

Read this when starting a client-thinning task, checking phase language, or
finding canonical code entry points. Full direction is in [`../plan.md`](../plan.md);
current snapshot in [`../status.md`](../status.md).

## Phase Language

- **Phases 0–3: DONE.** Workstream extraction, baseline projection/command/
  active-writer/guard contract, audit fixture reproducibility, and the
  command/projection invariant hardening families are complete. See
  [`../phases/README.md`](../phases/README.md).
- **Phase 4: DONE — chat-process server ownership.** A1 prompt-assembly content
  parity (slices 3a/3b/3c) and A2 post-generation durable derivation (slice 4)
  are **landed**; A3 is a hard-fail support cap.
- **Phase 5: ACTIVE closeout** — every A-item resolved or explicitly classified
  unsupported, group-chat legacy removal done, audit-rule hardening done, event
  patching shipped behind a closed reconnect/replay gap or still deferred.

## Main Code Entry Points

Server:

- `server/fastify/src/app.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/prompt/luaRuntime.ts`
- `server/fastify/src/prompt/triggers.ts`
- `server/fastify/src/prompt/history.ts`

Browser:

- `src/ts/process/index.svelte.ts`
- `src/ts/process/request/serverCompletion.ts`
- `src/ts/process/request/serverPromptAssembly.ts`
- `src/ts/storage/database.svelte.ts`

## Routers

- [`../plan.md`](../plan.md) — goal and blocker classification.
- [`../status.md`](../status.md) — current snapshot.
- [`next-steps.md`](next-steps.md) — prioritized work order.
- [`sendchat-thinning.md`](sendchat-thinning.md) — detailed A/B triage.
