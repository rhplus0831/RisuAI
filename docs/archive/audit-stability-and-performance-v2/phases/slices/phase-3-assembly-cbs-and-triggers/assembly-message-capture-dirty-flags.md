# Slice: Assembly Message Capture Dirty Flags

Phase: [3](../../phase-3-assembly-cbs-and-triggers.md). Finding: M1.
Runtime change.

## Scope

Stop prompt assembly from cloning and stringifying the full working transcript
when no message mutation happened. This slice owns the `assemble.ts` message
mutation checkpoints around run-vars, submit transforms, start-trigger history
normalization, regenerate prep, and user-message append bookkeeping.

This slice does not own transcript persistence in `messageStore.ts`, trigger
interpreter internals, template rendering, lorebook activation, or final prompt
bytes. Those are covered by later Phase 3 slices.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M1.
- `server/fastify/src/prompt/assemble.ts`: `resolveScope`,
  `beginAssembly`, `cloneMessages`, `equalJson`, `captureMessageReplacement`,
  `appendUserMessageRow`, `runInputTrigger`, `applyEditInput`,
  `applyCurrentChatRunVars`, `fillHistoryAndBias`,
  `captureSubmitTranscript`, `buildRestorationPayload`.
- Existing focused tests:
  `server/fastify/__tests__/assemble.test.ts`,
  `server/fastify/__tests__/generation.chat.test.ts`.

## Target Shape

- Replace unconditional full-transcript capture calls with explicit dirty
  decisions set by the mutators that can actually change messages:
  input-trigger transcript rewrite, `editinput`, regenerate truncation, start
  trigger chat edits, and run-var message text changes.
- Keep chat-var dirty state separate from message dirty state. A `{{setvar}}`
  or trigger var write should still persist through `varChanged` without
  forcing a message replacement capture when message rows are byte-identical.
- Skip the `history_normalize` capture entirely when no start trigger ran.
  `buildHistoryWindow` formats separate `OpenAIChat[]` rows in that case and
  does not mutate `state.currentChat.message`.
- Where a comparison remains necessary, compare before cloning. Prefer cheap
  length and per-row checks over `JSON.stringify` of both full arrays, and clone
  only after a change is proven.
- Make `appendUserMessageRow` maintain the mutation checkpoint with the single
  appended or normalized row instead of re-cloning the whole transcript.
- Avoid duplicate initial full-message snapshots. Keep the restoration payload
  correct, but do not keep both `initialMessages` and
  `messageMutationCheckpoint` as independent deep clones unless a test proves
  both are still required.
- Add a focused clone/stringify counting harness around plain send, run-var
  fixed-point, trigger rewrite, `editinput`, and regenerate paths.
- Register M1 as `DONE` in the v2 gate with focused cost and behavior tests,
  and flip the M1 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Prompt rows and mutation payloads remain byte-identical for unchanged plain
  sends, triggerless sends, `editinput`, input-trigger rewrites, regenerate, and
  stop-trigger restoration.
- `buildRestorationPayload` can still restore the original transcript and
  scriptstate after a stop/error path.
- A chat-var-only mutation must still produce the same chat-var delta and
  revision behavior as before.
- Message mutation order and `source` labels remain unchanged for real
  mutations.

## Done Criteria

- A plain send performs zero full-transcript clones/stringifies in the
  unchanged capture stages after scope resolution.
- Run-var fixed-point history performs no message replacement capture, while a
  real run-var text rewrite still captures exactly once.
- Input-trigger, `editinput`, start-trigger, and regenerate behavior tests prove
  mutation payloads and restoration payloads are unchanged.
- The v2 gate and active-risk row mark M1 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
