# Latest Verification

Date: 2026-06-07

This is the maintained proof-command log for the v3 workstream. Update it
after each change to a narrowed or bounded path.

## Current State

- Plan state: open; Phase 0 complete; Phase 1 is the next batch. All
  scheduled rows (`H1`, `M1-M9`, `L1-L56`, `K1-K4`) remain `PENDING` in
  [`active-risk-analysis.md`](active-risk-analysis.md); Phase 0 fixed no
  findings.
- Gate state: the v1 gate (`src/ts/__tests__/fixCompletenessGate.test.ts`)
  and the v2 gate (`fixCompletenessGateV2.test.ts`) remain live against their
  archives. The v3 gate (`fixCompletenessGateV3.test.ts`) is live against
  `docs/plan/`, with every scheduled v3 ID registered as `PLANNED`.
- Tree: Phase 0 test-only foundations are committed through `b824bd299`;
  this verification-refresh records the baseline and is not a runtime change.

## Phase 0 Baseline Run (2026-06-07)

Run after the v3 gate, send clone-count probe, and terminal-frame assertion
helper landed.

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts`:
  passed, 3 files / 50 tests. The v3 gate is green with all scheduled IDs
  `PLANNED`.
- `pnpm test`: passed, 152 files / 1337 passed / 4 skipped. The run emitted
  repeated `ECONNREFUSED 127.0.0.1:3000` lines and one Svelte warning before
  the final passing summary.
- `pnpm api:test`: passed, 100 files / 1853 passed / 1 skipped.
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.

Focused baseline confirmations:

- `pnpm exec vitest run src/ts/__tests__/sendCloneCountProbe.test.ts src/ts/__tests__/cloneCostGateCompleteness.test.ts`:
  passed, 2 files / 10 tests.
- Send clone-count baseline for one deterministic plain send:
  `jsonCloneCount: 44`, `structuredCloneCount: 2`, `totalCloneCount: 46`,
  `maxClonedSize: 10463`.
- Send fixture: 3 characters; 40 messages before send; 41 messages after
  submit; 42 final messages; 200-byte message bodies; transcript JSON before
  send `9941`; active chat JSON `10086`; active character JSON `10364`;
  characters JSON `11710`.
- Send command shape: 2 commands total; 1 message replace; 0 message append;
  1 character patch; 0 generation-result commands; 41 persisted messages;
  `persistedWholeTranscript: true`.
- Server-chat probe shape: 1 durable `send` call; user message length 16.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts __tests__/generation.chat.test.ts __tests__/terminalFrameAssertions.test.ts`:
  passed, 2 files / 68 tests. The terminal-frame helper smoke covers ordered
  SSE frame parsing/normalization, single terminal checks, success `done`,
  provider `error` then bare `done`, duplicate terminal rejection, and the
  no-success-`done` abort assertion helper.

## Inherited Baseline (v2 Phase 9 Closing Run, 2026-06-06)

Recorded in the v2 archive
([`../archive/audit-stability-and-performance-v2/latest-verification.md`](../archive/audit-stability-and-performance-v2/latest-verification.md))
at the same tree this plan starts from:

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts`:
  passed, 2 files / 26 tests.
- `pnpm test`: passed, 1312 passed / 4 skipped.
- `pnpm api:test`: passed, 1846 passed / 1 skipped.
- `pnpm client-thinning:audit`: passed.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- `pnpm check`: pre-existing 14-error svelte-check baseline in 5 files
  (documented; unrelated).

## Audit-Time Check (2026-06-06, v3 audit session)

Run at `ad07004ba` during the v3 audit:

- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- Full suites were not re-run during the audit (read-only); the inherited v2
  closing run above is the authoritative full baseline at this tree. Phase 0
  re-runs and re-records the full set.
