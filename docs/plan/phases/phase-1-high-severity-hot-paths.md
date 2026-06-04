# Phase 1: High-Severity Hot Paths

Status: not started. Three independent slices, one per high-severity finding.
Depends on the Phase 0 harness for the regression proofs.

Goal: fix the three high-severity findings — each a real ordinary-use cost on a
hot, user-facing path. H1 is a one-line guard change with the largest
blast-radius-to-effort ratio in the plan; H2 mirrors the already-landed
char-select fix; H3 removes accidentally-quadratic streaming work.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  findings **H1**, **H2**, **H3** (full evidence, impact, and verifier notes).
- H1: `server/fastify/src/repository.ts:1061` (`loadChatHydration`),
  `server/fastify/src/messageStore.ts` (`getChatHypaV3`, `getChatMessages`),
  callers `server/fastify/src/routes/projection.ts:287`/`:395`.
- H2: `src/ts/globalApi.svelte.ts:1817` (`changeChatTo`),
  `src/ts/chatCommands.ts:73-78` (`currentChatStateSnapshot`),
  `src/ts/characterCommands.ts` (`CharacterSelectionSnapshot` template),
  `src/lib/Others/ChatList.svelte`, `src/lib/SideBars/SideChatList.svelte`.
- H3: `src/lib/ChatScreens/Chat.svelte:375`,
  `src/lib/ChatScreens/ChatBody.svelte:259`,
  `src/ts/parser/parser.svelte.ts` (`ParseMarkdown`, `risuChatParser`),
  `src/ts/process/postGeneration/streamResponse.ts`,
  `src/ts/process/request/serverChat.ts`,
  `server/fastify/src/routes/generation.ts` (`writeSseChunk`).

## Slices

- [`h1-hydration-fallback-guard.md`](slices/phase-1-high-severity-hot-paths/h1-hydration-fallback-guard.md) -
  early-return `loadChatHydration` on `message.length > 0` so a non-HypaV3
  chat-open / generation completion stops falling into the whole-corpus
  `loadPersisted`; keep the fallback only for a genuinely not-yet-extracted chat
  (`message.length === 0`).
- [`h2-chat-selection-snapshot.md`](slices/phase-1-high-severity-hot-paths/h2-chat-selection-snapshot.md) -
  add a scalar `ChatSelectionSnapshot`/`restoreChatSelection` pair (mirroring
  `CharacterSelectionSnapshot`) and use it in `changeChatTo` instead of the
  whole-`characters` `currentChatStateSnapshot()`.
- [`h3-streaming-render-coalescing.md`](slices/phase-1-high-severity-hot-paths/h3-streaming-render-coalescing.md) -
  coalesce token-driven renders to at most one parse per animation frame, with a
  full-fidelity flush on the terminal `done` frame; optionally batch provider
  deltas into fewer SSE frames.

## Planned Shape

- H1: the messages table is authoritative once populated; a legitimately
  `undefined` `hypaV3Data` must not force a whole-corpus load. The fallback stays
  for the zero-rows not-yet-extracted case.
- H2: chat selection mutates one scalar (`chatPage`) + dispatches an empty-patch
  select, so a scalar rollback (capture `selectedCharID` + the target's
  `chatPage`, locate by `chaId` on restore) fully covers it. Keep
  `currentChatStateSnapshot` for restructures.
- H3: render coalescing is the behavior-preserving fix; a prefix-memo of
  `ParseMarkdown` is unsafe because `editdisplay`/`display`/CBS can depend on the
  whole message. Keep auto-scroll and the final full parse on `done`.

## Exit Criteria

- [ ] H1: `loadChatHydration` does not call `loadPersisted` for a chat that has
      message-table rows and no `chat_hypa_v3` row; the not-yet-extracted
      (zero-rows) fallback still works. Regression test asserts the load-count.
- [ ] H2: `changeChatTo` captures a scalar chat-selection snapshot; a clone-cost
      test proves it does not clone the `characters` array; a rollback-correctness
      test proves a failed select restores only `chatPage`/`selectedChar` and does
      not clobber unrelated edits. `currentChatStateSnapshot` remains for
      restructures.
- [ ] H3: for an N-token stream the displayed message is parsed O(frames-per-sec ×
      duration) times, not O(N); rendered output and persisted text are identical
      to before; a test bounds the render/parse count for a synthetic N-token
      stream.
- [ ] Each fix registers its gate in Phase 8; full suites + audit + both
      TypeScript checks are green.

## Validation

- H1: `pnpm api:test -- server/fastify/__tests__/projection.test.ts` plus a new
  `loadChatHydration` load-count test.
- H2: `pnpm test -- src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts`.
- H3: `pnpm test -- src/lib/ChatScreens` plus the parser suite (bounded
  render-count test); browser profiler spot-check on a long stream.
- `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`.
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
