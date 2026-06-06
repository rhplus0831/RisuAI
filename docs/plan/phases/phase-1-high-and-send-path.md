# Phase 1: High Severity & Send Path (Themes 1+3)

Status: complete.

Goal: land the audit's top-priority fixes — restore the abort contract for
every streaming provider (the one high), and remove the O(transcript) clones
and full-transcript upload from the hottest user action.

Findings: H1, M4, M5.

## Completed Slices

Slices live under `slices/phase-1-high-and-send-path/`; the v2 Phase 1 slices
were the structural template
([`../../archive/audit-stability-and-performance-v2/phases/slices/phase-1-high-severity-hot-paths/`](../../archive/audit-stability-and-performance-v2/phases/slices/phase-1-high-severity-hot-paths/)).

- [transport-abort-contract](slices/phase-1-high-and-send-path/transport-abort-contract.md)
  (H1) — guard `emitProviderChunks`' post-loop fallthrough on
  `signal?.aborted` and re-check the signal before the in-loop terminal emit;
  durable-cancel tests assert an abort-shaped terminal path (no success
  `done`, no output-trigger/scriptstate persistence) for explicit DELETE
  cancel, sliding-deadline abort, the in-loop race, and the non-streaming
  `resultFrames` arm.
- [send-append-fast-path](slices/phase-1-high-and-send-path/send-append-fast-path.md)
  (M4) — route plain sends through the single-message append command
  (`appendCurrentChatUserMessageForSend` shape) with an id-keyed
  remove-on-failure rollback; keep the replace path only for transcripts an
  input trigger actually rewrote; drop the now-redundant message-array clone.
- [send-rollback-field-scope](slices/phase-1-high-and-send-path/send-rollback-field-scope.md)
  (M5) — replace the per-send `currentCharacterRowSnapshot` with a
  field-scoped snapshot (`lastInteraction`; pre-mutation `message[]` only on
  the first-send backfill branch), `restoreCharacterSelection` shape, with a
  matching narrowed restore.
- [phase-1-verification-refresh](slices/phase-1-high-and-send-path/phase-1-verification-refresh.md)
  — gates, clone-count before/after proof, full validation,
  latest-verification update. The v1/v2 archive gates and Phase 1 v3 gate are
  green, with only H1, M4, and M5 marked `DONE`.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  H1, M4, M5 (read the verifier corrections; they scope the fixes).
- H1: `server/fastify/src/prompt/providerTransport.ts`
  (`emitProviderChunks`); silent-return adapters in
  `server/fastify/src/generation/*.ts`; `prompt/chatDispatch.ts`
  (`resultFrames`); consumer `routes/generationChat.ts` (durable abort
  branch, `persistRawCancelledResult`).
- M4: `src/lib/ChatScreens/DefaultChatScreen.svelte` (send handler),
  `src/ts/chatCommands.ts` (`currentChatScopedSnapshot`,
  `dispatchReplaceMessagesWith`, `dispatchAppendMessage`,
  `appendCurrentChatUserMessageForSend`), `src/ts/server/commands.ts`
  (`appendMessageCommand`, `replaceMessagesCommand`).
- M5: `src/ts/process/sendChatContext.ts` (`setupSendChatContext`),
  `src/ts/characterCommands.ts` (`currentCharacterRowSnapshot`,
  `restoreCharacterRow`, `CharacterSelectionSnapshot`/
  `restoreCharacterSelection`).

## Implemented Shape

- H1 is a contract restoration, not a behavior redesign: the documented
  "emits nothing on abort" contract already has a consumer branch
  (`persistRawCancelledResult`) — the guard makes the existing branch
  reachable again. The inline `streamAssembly` arm is dead on the live
  runtime (gate item R1); do not build new machinery for it.
- M4 changes which EXISTING protocol command the plain send uses
  (append instead of replace). Event consumers (`messages.appended` vs
  `messages.replaced`) must be re-verified; the server diff path already has
  the O(1) append fast-path (v2-L14), so the win is client clones + upload
  bytes + server body parse.
- M5's restore must narrow together with the snapshot: in steady state
  restore only `lastInteraction` (never the whole row), mirroring
  `restoreCharacterSelection`.
- H1 lands first; it is independent of M4/M5.

## Exit Criteria

- [x] H1: cancelling a streaming durable generation (explicit DELETE and
      deadline) yields an aborted terminal, no success `done`, no output
      trigger run, no scriptstate persistence from the cancelled turn; the
      narrow in-loop race is covered; non-streaming abort path equally
      guarded.
- [x] M4: a plain send performs zero full-transcript clones and uploads one
      message (clone-count probe before/after); trigger-rewritten
      transcripts still replace correctly; rollback on append failure
      removes exactly the appended row.
- [x] M5: the per-send snapshot clones no `message[]` in steady state;
      first-send backfill and its rollback still work; `lastInteraction`
      rollback restores only that field.
- [x] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm api:test
pnpm test
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
