# Slice: Replace-All Message Patch No Clone

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: M7. Runtime
change.

## Scope

Remove the redundant transcript clone when applying a server-backed
`replace_all` message mutation. The server event payload has already been
deserialized into a private array owned by the patch, so the client can install
that array directly, or at most with a shallow array copy.

This slice does not own the longer-term protocol change from `replace_all` to
incremental changed-index mutations.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M7.
- `src/ts/process/request/serverMessagePatch.ts`: `applyMessageMutation`,
  `cloneMessages`, `applyServerMessagePatch`.
- `src/ts/process/request/serverBackedSendChat.ts`: assembly and terminal
  patch consumers.
- `server/fastify/src/prompt/assemble.ts`: `captureMessageReplacement`
  source of `replace_all` mutations.
- Existing focused tests:
  `src/ts/process/request/tests/serverMessagePatch.test.ts`,
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`.

## Target Shape

- In the `replace_all` branch, assign `chat.message` from
  `mutation.messages` without calling `structuredClone`.
- Keep `append` and other single-message mutation branches detached as they
  are today; M7 is only about full transcript replacement.
- Add a clone-count assertion around `applyServerMessagePatch` proving a
  `replace_all` apply performs zero `structuredClone` calls.
- Keep the applied transcript identical to the previous behavior for message
  order, roles, data, IDs, and optional fields.
- Register M7 as `DONE` in the v2 gate with the focused clone-count and
  behavior tests, and flip the M7 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Applying a patch must not mutate unrelated chat metadata, `scriptstate`, or
  additional system prompt state except through the existing mutation handlers.
- The patch payload must not be reused by another live chat after assignment.
  If a caller ever shares a patch object across chats, clone there instead of
  reinstating the transcript clone in the hot apply path.
- Append normalization for an already-local user message remains unchanged.

## Done Criteria

- `replace_all` message patch application records zero `structuredClone`
  calls.
- The transcript after a `replace_all` patch is byte-identical to the previous
  expected test fixture.
- The v2 gate and active-risk row mark M7 `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/request/tests/serverMessagePatch.test.ts \
  src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
