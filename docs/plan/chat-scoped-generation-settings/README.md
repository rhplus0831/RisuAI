# Chat-Scoped Generation Settings Plan

Date: 2026-06-10

This active workstream moves generation-affecting persona, preset, and sidebar
toggle selections from global settings onto each chat. A chat cannot send,
continue, regenerate, or preview until the user explicitly confirms all three
parts for that chat.

Start with [`status.md`](status.md), then read [`plan.md`](plan.md), then the
phase files under [`phases/`](phases/). The Phase 5 closeout proof is recorded
in [`latest-verification.md`](latest-verification.md).

## Read Order

1. [`status.md`](status.md) - current phase router and open work.
2. [`plan.md`](plan.md) - goal, contract, invariants, and non-goals.
3. [`latest-verification.md`](latest-verification.md) - latest closeout proof
   and residual-gap record.
4. [`phases/README.md`](phases/README.md) - phase index.
5. [`phases/phase-0-contract.md`](phases/phase-0-contract.md) - lock the data,
   readiness, and error contract before runtime edits.
6. [`phases/phase-1-chat-metadata-and-commands.md`](phases/phase-1-chat-metadata-and-commands.md)
   - persist and project chat-owned settings.
7. [`phases/phase-2-effective-generation-config.md`](phases/phase-2-effective-generation-config.md)
   - server prompt gate and per-chat effective database overlay.
8. [`phases/phase-3-ui-and-send-gating.md`](phases/phase-3-ui-and-send-gating.md)
   - sidebar controls and pre-append client blocking.
9. [`phases/phase-4-import-delete-fork-edges.md`](phases/phase-4-import-delete-fork-edges.md)
   - lifecycle, import, fork, and deletion behavior.
10. [`phases/phase-5-verification.md`](phases/phase-5-verification.md) - focused
    regression and TypeScript proof.

## Sub-Agent Inputs

This plan incorporates three parallel investigations:

- Server/data/prompt scope: chat metadata, command surface, prompt assembly,
  provider dispatch, and overlay risks.
- Frontend/UI scope: active-chat config helpers, sidebar controls, picker
  behavior, and pre-append send guards.
- Test/import/compat scope: import normalization, Realm behavior, fork/delete
  edges, rollout messaging, and validation matrix.

## Source Anchors

- Chat model and client patching:
  `src/ts/storage/database.svelte.ts`, `src/ts/chatCommands.ts`.
- Server chat commands and persistence:
  `server/fastify/src/commands/chats.ts`,
  `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/repository.ts`,
  `server/fastify/src/databaseDefaults.ts`.
- Prompt assembly and dispatch:
  `server/fastify/src/routes/generationChat.ts`,
  `server/fastify/src/prompt/assemble.ts`,
  `server/fastify/src/prompt/promptScope.ts`,
  `server/fastify/src/prompt/staticSections.ts`,
  `server/fastify/src/prompt/chatDispatch.ts`.
- Sidebar and send UI:
  `src/lib/SideBars/CustomSidebar.svelte`,
  `src/lib/SideBars/Toggles.svelte`,
  `src/lib/SideBars/SideChatList.svelte`,
  `src/lib/Setting/botpreset.svelte`,
  `src/lib/Setting/listedPersona.svelte`,
  `src/lib/ChatScreens/DefaultChatScreen.svelte`,
  `src/ts/process/index.svelte.ts`,
  `src/ts/process/serverBackedSendChat.ts`.
- Import and restore paths:
  `server/fastify/src/risuSave/importSnapshot.ts`,
  `server/fastify/src/routes/save.ts`,
  `server/fastify/src/routes/realmImport.ts`,
  `server/fastify/src/realmImport/characterCard.ts`,
  `src/ts/characters.ts`,
  `src/ts/characterCards.ts`.

For current repo navigation, read [`../../../STRUCTURE.md`](../../../STRUCTURE.md)
and the focused files under [`../../structure/`](../../structure/).
