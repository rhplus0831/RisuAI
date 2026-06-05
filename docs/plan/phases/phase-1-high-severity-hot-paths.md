# Phase 1: High-Severity Hot Paths

Status: proof-refreshed on 2026-06-06. H2, H3, and H1 are `DONE` in the v2
gate and active-risk map. Focused H1-H3 suites, both gates, `pnpm test`,
client-thinning audit, TypeScript checks, and full `pnpm api:test` passed.
The H2 chat-create ceiling assertion now expects the targeted
`targeted-character-row` path.

Goal: remove the worst routine-action corpus-scaling stall (H2), stop the
whole-screen cold re-parse per variable write (H3), and make the V2 trigger
interpreter budgeted and abortable (H1).

Findings: H1, H2, H3.

## Slices

- H2:
  [`slices/phase-1-high-severity-hot-paths/chat-create-targeted-writer-kit.md`](slices/phase-1-high-severity-hot-paths/chat-create-targeted-writer-kit.md)
  - route chat-create through the targeted writer kit.
- H3:
  [`slices/phase-1-high-severity-hot-paths/var-only-gui-reload-narrowing.md`](slices/phase-1-high-severity-hot-paths/var-only-gui-reload-narrowing.md)
  - decouple var-only GUI reloads from whole-screen remounts and cache wipes.
- H1:
  [`slices/phase-1-high-severity-hot-paths/trigger-interpreter-budget-and-abort.md`](slices/phase-1-high-severity-hot-paths/trigger-interpreter-budget-and-abort.md)
  - add signal, wall-clock budget, loop caps, and recursion bounds.
- Proof:
  [`slices/phase-1-high-severity-hot-paths/phase-1-verification-refresh.md`](slices/phase-1-high-severity-hot-paths/phase-1-verification-refresh.md)
  - refresh gates, full validation, and latest verification.

## Source Anchors

- [`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md) -
  H1, H2, H3 (read the verifier corrections; they narrow the triggers).
- H1: `server/fastify/src/prompt/triggers.ts` (`runTrigger`, `v2EndIndent`,
  the `loopTimes` lag guard, the `recursiveCount < 10 || lowLevelAccess`
  gate, `TriggerRunContext`); budget precedent
  `server/fastify/src/prompt/luaRuntime.ts` (`LuaExecBudget`).
- H2: `server/fastify/src/routes/commands.ts` (chat-create
  `POST /commands/characters/:characterId/chats` on
  `applyJsonCommandMutation`; the fork route's writer-kit shape);
  `server/fastify/src/commands/mutations.ts`,
  `server/fastify/src/messageStore.ts` (`replaceActiveChatMessages`).
- H3: `src/ts/stores.svelte.ts` (`ReloadGUIPointer.subscribe` ->
  `ReloadChatPointer.set({})` + `resetScriptCache()`),
  `src/lib/ChatScreens/Chat.svelte` (`{#key chatReloadPointer}`),
  `src/ts/process/scripts.ts` (`resetScriptCache`,
  `processScriptCache`/`compiledRegexCache`),
  `src/ts/process/triggers.ts` (`varChanged` bump, `v2UpdateGUI`).

## Planned Shape

- H2: route chat-create through `applyTargetedCommandMutation` with the
  fork-route writers (`ensureCharacterChats` on a scoped read,
  `writeCharacterChatRows` + `insertCharacterChatRow(position 0)` +
  `replaceActiveChatMessages(newChatId)` + `writeSingleCharacterRow`). Keep
  duplicate-id validation and the select-created semantics identical.
- H3: bump only per-message `ReloadChatPointer` entries (or drop the `{#key}`
  remount for var-only changes) and stop wiping
  `processScriptCache`/`compiledRegexCache` on var-only bumps. Any fix must
  target the module-level caches; ChatBody instance state dies on remount.
  Preserve the v1 H3 stream-coalescer behavior and the Phase 7 regex-memo
  tests.
- H1: thread `state.signal` into `TriggerRunContext`; check `signal?.aborted`
  in the effect loop and at every `v2EndIndent` loop-back; add a hard
  total-iteration ceiling for `v2Loop`/`v2LoopNTimes` and a `runTrigger`
  wall-clock budget mirroring `LuaExecBudget`; bound recursion even with
  `lowLevelAccess`. Budget exhaustion degrades to a logged early-return, not
  a crash.

## Exit Criteria

- [x] H2: chat-create performs zero whole-corpus message reads and zero
      whole-DB clones (load-count assertion); created chat + selection +
      revision/event output byte-identical to the broad path on the fixture.
- [x] H3: the render-count probe shows a var-only `ReloadGUIPointer` bump
      re-parses only the affected messages (0 or per-message), not all N;
      `processScriptCache`/`compiledRegexCache` survive var-only bumps;
      module/settings reloads still refresh everything.
- [x] H1: a never-breaking `v2Loop`, a huge `v2LoopNTimes`, and a low-level
      self-recursive trigger all terminate within the budget; client
      disconnect aborts a running trigger pass; normal trigger suites pass
      byte-identical.
- [x] Gates registered (v2 gate flips H1-H3 to `DONE`); focused suites +
      TypeScript checks green; [`../latest-verification.md`](../latest-verification.md)
      updated.
- [x] Full `pnpm api:test` green. 2026-06-06 proof passed 99 files; 1744
      passed / 1 skipped after refreshing the H2 chat-create ceiling
      expectation in `server/fastify/__tests__/commandMessageFreeCeiling.test.ts`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/triggers.test.ts
pnpm exec vitest run src/ts/process/__tests__/streamResponse.test.ts src/ts/process/triggers.regexMemo.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
