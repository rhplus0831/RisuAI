# BardWiki Memory Plan

Date: 2026-08-29

This completed workstream records the delivery of a per-chat BardWiki memory
system: human-readable
Markdown documents, wikilinks, deterministic prompt retrieval, and durable
server-side background updates after an assistant turn is confirmed.

The workstream deliberately separates manual wiki storage and retrieval from
autonomous model-authored updates. Each capability must be useful and tested
before the next one is enabled.

## Read Order

1. [`status.md`](status.md) - live phase router, current cursor, and blockers.
2. [`PLAN.md`](PLAN.md) - product decisions, target architecture, invariants,
   phase boundaries, and non-goals.
3. [`latest-verification.md`](latest-verification.md) - final commands, counts,
   behavior matrix, measurements, and caveats.
4. [`phases/README.md`](phases/README.md) - completed phase index and execution
   rules used during implementation.

## Primary Architecture Sources

- [`../../../STRUCTURE.md`](../../../STRUCTURE.md)
- [`../../../docs/structure/bardwiki.md`](../../../docs/structure/bardwiki.md)
- [`../../../docs/structure/data-and-events.md`](../../../docs/structure/data-and-events.md)
- [`../../../docs/structure/durable-mutations-and-recovery.md`](../../../docs/structure/durable-mutations-and-recovery.md)
- [`../../../docs/structure/prompt-assembly-and-scripting.md`](../../../docs/structure/prompt-assembly-and-scripting.md)
- [`../../../src/docs/svelte-settings-ui.md`](../../../src/docs/svelte-settings-ui.md)
- [`../../../src/docs/svelte-chat-ui.md`](../../../src/docs/svelte-chat-ui.md)

## Primary Runtime Anchors

- Settings and UI:
  - `src/lib/Setting/Settings.svelte`
  - `src/lib/Setting/Pages/OtherBotSettings.svelte`
  - `src/lib/ChatScreens/DefaultChatScreen.svelte`
  - `src/ts/routerRoute.ts`
  - `src/ts/server/resourceManifest.ts`
- Persistence, commands, and lifecycle:
  - `server/fastify/src/db.ts`
  - `server/fastify/src/repository.ts`
  - `server/fastify/src/messageStore.ts`
  - `server/fastify/src/routes/commands.ts`
  - `server/fastify/src/commands/mutations.ts`
- Jobs and generation:
  - `server/fastify/src/memoryRepository.ts`
  - `server/fastify/src/memoryWorker.ts`
  - `server/fastify/src/memoryEvents.ts`
  - `server/fastify/src/routes/generationChat.ts`
  - `server/fastify/src/routes/generationOperations.ts`
- Prompt assembly:
  - `server/fastify/src/prompt/assemble.ts`
  - `server/fastify/src/prompt/memory.ts`
  - `server/fastify/src/prompt/templates.ts`
  - `server/fastify/src/prompt/budgetFinalize.ts`

Line numbers are intentionally omitted. Resolve symbols again at the start of
each phase because this is a long-running workstream.

## Planning Inputs

This plan incorporates the completed inspection of `/home/codex/RisuBard` and
the cross-checked exploration of the Fastify settings, generation-finalization,
memory-worker, storage, resource, and prompt-assembly boundaries. The source
application is a behavioral reference, not a storage or transaction template.
