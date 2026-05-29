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
- **Phase 5: ACTIVE closeout.** A-items are resolved, the known defeated audit
  rules are hardened, and the group-chat UI-branch removal landed. Both
  pending-implementation batches landed 2026-05-30 — the provider-resolver
  unification (#5, shared `resolveProviderCapability`) and the
  `useServerPromptAssembly` default flip (#1, now `true`). Remaining is optional
  cleanup (decision #6 stale group strings/comments) and deferred work
  (event patching, further shallow-audit-rule hardening) gated on a precondition.

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
