# Broad Closeout Alpha Follow-Up - Typecheck

Date: 2026-05-27

Status: open.

## Goal

Restore broad alpha closeout by making `pnpm check` pass without
expanding the focused Phase 5, 6, or 9 functional slices.

## Closeout Finding

The latest 2026-05-27 broad verification pass failed at `pnpm check`
with 58 diagnostics across 18 files. The rest of the matrix passed in
the same workspace:

- `pnpm test`: passed, 67 files, 742 tests passed, 4 skipped.
- `pnpm api:test`: passed, 68 files, 1212 tests passed.
- `pnpm build`: passed with nonblocking CSS pseudo-element,
  browser-externalized module, chunk-size, and plugin-timing warnings.
- `pnpm smoke:fastify-browser`: passed, 1 browser smoke test.

## Error Buckets

- Fastify command and generation result narrowing:
  `server/fastify/src/commands/scriptDefinitions.ts`,
  `server/fastify/src/generation/gemini.ts`,
  `server/fastify/src/routes/generation.ts`, and
  `server/fastify/src/routes/generationChat.ts`.
- Memory repository SQLite row typing and memory job payload/result
  narrowing:
  `server/fastify/src/memoryRepository.ts`,
  `server/fastify/src/routes/memoryJobs.ts`,
  `server/fastify/src/memoryEmbeddingAdapter.ts`,
  `server/fastify/src/memoryEmbedJobHandler.ts`,
  `server/fastify/src/memorySummaryAdapter.ts`, and
  `server/fastify/src/memorySummarizeJobHandler.ts`.
- Fetch `BodyInit` compatibility for buffered proxy bodies:
  `server/fastify/src/routes/hub.ts`,
  `server/fastify/src/routes/proxy.ts`, and
  `server/fastify/src/streamJobs.ts`.
- Prompt assembly type drift:
  `server/fastify/src/prompt/variables.ts`,
  `server/fastify/src/prompt/lorebook.ts`, and
  `server/fastify/src/prompt/triggers.ts`.
- Server-backed sendChat fixture typing:
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`.
- Client test fixture typing:
  `src/ts/process/modules.test.ts`.

## Tasks

- Re-run `pnpm check` first and keep the current diagnostics grouped by
  code surface before editing.
- Fix type narrowing at the source where practical: discriminate result
  unions explicitly, narrow `unknown` values before numeric or index use,
  and keep SQLite row mapping typed at repository boundaries.
- Keep behavior changes minimal. Do not add compatibility migrations for
  intermediate Fastify shapes.
- If a typecheck failure exposes a real behavior regression, open a
  dedicated phase finding before broadening scope.
- After `pnpm check` passes, rerun the broad closeout matrix and browser
  smoke.

## Boundaries

- Do not expand Phase 5, 6, or 9 solely because their files appear in
  the typecheck output; widen a focused slice only for a confirmed
  behavior regression.
- Do not turn this doc into a long work log. Move landed closeout detail
  to `../phases-completed/` after the slice closes.

## Exit Criteria

- `pnpm check` passes.
- `pnpm test`, `pnpm api:test`, `pnpm build`, and
  `pnpm smoke:fastify-browser` pass after the cleanup.
- The live status and next-step docs reflect the final closeout result.

## Verification

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```
