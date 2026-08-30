# Cross-Runtime Boundaries Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `6fc15d7a1`
- Shared-core predecessor: chat load-page normalization at `c12e807a5`
- Opening Phase 0 gate: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 3 chat display-tail normalization leaf;
  no route, payload, persistence, revision, event, authentication,
  active-writer, credential, host, generation, or UI behavior changed.

## Shared-Core And Consumer Proof

- `@risuai/shared-core` is private, side-effect-free, independently typechecked,
  and guarded against bare, dynamic, require, and package-escape runtime
  imports.
- `DEFAULT_CHAT_DISPLAY_TAIL_COUNT`, its `1..500` bounds, and
  `normalizeChatDisplayTailCount` have one owner at
  `@risuai/shared-core/chat-display-tail-count`.
- The shared implementation has no imports, side effects, runtime-specific
  inputs, or host behavior. Differential fixtures preserve number/string
  coercion, blank and non-finite fallback, rounding, and clamping.
- Fastify defaulting and browser storage normalization use the explicit
  subpath; the browser normalization still feeds the legacy initial-page
  fallback, and a closed-world ownership test prevents the old browser-tree
  implementation from returning.
- The architecture inventory now records 334 direct root-`src` edges: 231
  production, 95 server-test, and 8 browser-smoke; 171 are runtime/mixed.

## Commands And Results

- `pnpm test -- packages/shared-core/src/chatDisplayTailCount.test.ts` passed 21
  differential/default/bounds tests; the ownership test passed 1 test.
- `pnpm test -- packages/shared-core/src/chatDisplayTailCount.ts` passed the 345
  related frontend files with 5,297 tests; no server test directly imported the
  workspace source through Vitest's related-file graph.
- `pnpm test -- server/fastify/__tests__/databaseDefaults.test.ts` passed 24
  Fastify defaulting tests, including the unchanged display-tail default.
- `pnpm test -- util/architecture-inventory.test.ts` passed 10 inventory tests.
- `pnpm exec tsx util/architecture-inventory.ts` passed the 334-edge boundary,
  19-surface/38-probe compatibility, 9,917-reference/325-group client
  ownership, and 56-row owner-gap inventories.
- Shared-core TypeScript, root `pnpm check`, the client declaration prerequisite,
  Fastify TypeScript, and browser-smoke TypeScript passed. A direct Fastify
  TypeScript attempt before regenerating client declarations failed with the
  expected stale-declaration diagnostics; it passed after the documented
  prerequisite.
- Focused Prettier and `git diff --check` passed.

## Dependency Release And Verdict

Chat display-tail normalization is released without changing settings,
payloads, persistence, loading, or rendering. Phase 3 continues with regex
output-size normalization; declaration decoupling and the remaining 334
root-`src` edges remain explicitly open.
