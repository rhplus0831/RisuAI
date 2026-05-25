# Phase 8 Memory - 8-7b Closeout

Date: 2026-05-25

## Scope Landed

- Added `src/ts/process/request/serverMemory.ts`.
- Added a Fastify-gated browser memory API adapter via
  `canUseServerMemoryApi`.
- Added authenticated server-backed calls for:
  - `GET /api/v1/memory/chunks/:chatId`
  - `GET /api/v1/memory/summaries/:chatId?model=...`
  - `GET /api/v1/memory/jobs`
  - `DELETE /api/v1/memory/jobs/:id`
- Preserved the current Fastify JSON contracts directly:
  `{ chunks }`, `{ summaries }`, `{ jobs }`, and `{ job }`.
- Added focused browser adapter coverage in
  `src/ts/process/request/tests/serverMemory.test.ts` for auth headers,
  URL/query encoding, Fastify gating, envelope parsing, cancellation,
  route errors, and network errors.

## Boundaries

- No server route, schema, or repository changes were needed.
- No compatibility adapters for old intermediate Fastify/browser memory
  shapes were added.
- No progress listener, list/cancel UI, embedding provider dispatch, or
  browser-local runtime removal landed in this slice.

## Verification

Passed:

```bash
pnpm exec vitest run src/ts/process/request/tests/serverMemory.test.ts
```

Focused 8-7b verification passed with 9 tests.

## Next Pickup

Continue with 8-7c - Browser progress listener. Wire server memory
progress side effects into the existing `hypaV3ProgressStore` shape while
keeping list/cancel UI wiring for later 8-7 slices.
