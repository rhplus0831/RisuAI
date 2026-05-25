# Phase 8 Memory - 8-7c Closeout

Date: 2026-05-25

## Scope Landed

- Added `applyServerHypaV3Progress` to
  `src/ts/process/request/serverMemory.ts`.
- Kept the progress mapper behind the existing Fastify/server-memory gate.
- Consumed the Fastify `hypav3_progress` side-effect payload shape and
  validated the browser-visible progress fields.
- Preserved the existing `hypaV3ProgressStore` contract by setting only
  `open`, `miniMsg`, `msg`, and `subMsg`.
- Wired server-backed chat terminal side-effect handling to apply
  `hypav3_progress` payloads alongside the existing TTS side effect path.
- Extended focused browser memory adapter tests for progress application,
  malformed payloads, and unavailable Fastify mode.

## Boundaries

- No server route, schema, repository, or event-contract changes were
  needed.
- No dedicated browser memory event stream was added; the slice consumes
  the existing server chat terminal side-effect path.
- No job list/cancel UI controls, fixture parity updates, provider
  embedding work, or legacy browser-local Hypa V3 runtime removal landed
  in this slice.

## Verification

Passed:

```bash
pnpm exec vitest run src/ts/process/request/tests/serverMemory.test.ts
pnpm check
```

Focused 8-7c verification passed with 11 browser adapter tests, and
`pnpm check` was clean.

## Next Pickup

Continue with 8-7d - Memory job list/cancel UI path. Use the existing
`listServerMemoryJobs` and `cancelServerMemoryJob` helpers from
`src/ts/process/request/serverMemory.ts`; keep the browser UI path
minimal and gated to Fastify/server-backed mode.
