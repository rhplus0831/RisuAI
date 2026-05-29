# Latest Verification

Date: 2026-05-30

- Command: `pnpm client-thinning:audit`
- Result: Passed. The audit printed `Client-thinning audit passed.`
- Command: `pnpm api:test`
- Result: Passed. 72 test files, 1310 tests.
- Command: `pnpm test`
- Result: Passed. 82 test files, 886 tests (4 skipped).

Context: shared verification at HEAD after **slice 3c** (image-gen instruction).
`buildInlayViewInstruction` is ported into `server/fastify/src/prompt/staticSections.ts`
and wired into `assemble.ts::fillStaticSlots`; the classifier's
`charHasImageGenInstruction` predicate is deleted so a char with `inlayViewScreen`
routes `server`. New proofs: the `image-gen-emotion` / `image-gen-imggen` local
fixtures + serverBacked byte-parity (`sendChat.fixtures.serverBacked.test.ts`
Describe B), the server `staticSections.test.ts` unit cases, the
`generation.chat.test.ts` instruction-row assertions, and the flipped classifier
case in `serverPromptAssembly.test.ts`. A1 content graduation (slices 3a/3b/3c) is
complete.
