# Slice: Chat Metadata Allowed-Key Diff

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: M9. Runtime
change.

## Scope

Narrow `changedChatMetadata` so it diffs only the server-allowed chat metadata
keys and clones only changed allowed values. This mirrors the landed
`changedCharacterFields` v1-M13 shape.

This slice does not own message transcript replacement, chat scriptstate
patches, chat selection snapshots, or folder-row metadata helpers.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M9.
- `src/ts/chatCommands.ts`: `CHAT_PATCH_ALLOWED_KEYS`, `sanitizeChatPatch`,
  `changedChatMetadata`, `dispatchCompatibleChatUpdateScoped`.
- Precedent: `src/ts/characterCommands.ts` `changedCharacterFields`.
- Existing focused tests:
  `src/ts/chatCommands.test.ts`,
  `src/ts/compatibilityAdapters.test.ts`.

## Target Shape

- Iterate `CHAT_PATCH_ALLOWED_KEYS` over the raw `previous` and `current` chat
  records instead of cloning and sanitizing both whole chats up front.
- For each allowed key, compare serialized values or an equivalent stable
  value comparison that preserves existing patch decisions.
- Clone only the changed allowed value placed in the patch.
- Do not include disallowed keys such as `message`, `localLore`, or
  `hypaV3Data`.
- Preserve delete semantics for allowed keys: if the current value is
  `undefined`, keep matching the current `sanitizeChatPatch` behavior.
- Add clone-cost coverage proving a long `message[]` payload is not cloned
  while detecting changes to allowed scalar/object metadata.
- Register M9 as `DONE` in the v2 gate with clone-cost and behavior tests, and
  flip the M9 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Compatible chat updates still produce the same server command factories for
  each allowed metadata change.
- Message-only changes must not appear in a metadata patch.
- Forced command failure rollbacks still restore exactly the scoped chat fields
  already covered by chat rollback tests.

## Done Criteria

- `changedChatMetadata` no longer clones the full chat or transcript.
- Allowed metadata diffs are byte-identical to the old sanitized result.
- Message-only changes produce an empty metadata patch.
- The v2 gate and active-risk row mark M9 `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
