# Phase 8 Memory - 8-6c Closeout

Date: 2026-05-25

## Scope Landed

- Extended `AssembleDeps` with optional prompt-memory dependencies:
  `loadMemoryDatabase` and `loadPromptMemoryQueryVectors`.
- Bound the generation routes to pass the live SQLite memory database
  into prompt assembly. Query vectors are supplied by the dependency
  boundary and are empty in the route path until provider-backed query
  generation lands later.
- Wired `fillMemoryAndPostHistory` to resolve active Hypa V3 settings,
  call `selectPromptMemory`, assemble canonical `hypaMemory` rows through
  `assemblePromptMemoryRows`, and prepend those rows into the existing
  `buildMemoryWindow` split.
- Preserved the `prompt/memory.ts` contract: template memory cards
  consume Hypa rows through `state.memories`, while no-memory-card paths
  wrap them inline as previous conversation.
- Stored selection and row-assembly diagnostics on `AssemblyState` for
  the next missing-memory follow-up slice.
- Added focused assembler tests using a real seeded memory SQLite
  database to prove canonical rows reach the memory-card path and inline
  path without adding provider or queue work.

## Boundaries

- No schema change was needed.
- No provider-backed query embedding generation landed.
- No summary generation, embedding generation, chunk planning, queue
  writes, or missing-memory follow-up enqueueing landed.
- The root assembler builds only on `selectPromptMemory` and
  `assemblePromptMemoryRows`; it does not call repository, ranking,
  allocation, or row-shaping helpers directly.
- Missing-memory diagnostics remain passive until 8-6d.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused 8-6c verification passed with 49 tests. `pnpm check` was clean.
The full matrix also passed: `pnpm test` with 639 tests plus 4 skipped,
`pnpm api:test` with 1039 tests, and `pnpm build` with the existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-6d - Missing-memory follow-up enqueue. Consume the
passive diagnostics now available on `AssemblyState`, enqueue idempotent
`chunk`, `summarize`, and `embed` jobs best-effort, and keep prompt
assembly non-blocking. Provider-backed query embeddings and synchronous
summary/embedding work remain out of scope.
