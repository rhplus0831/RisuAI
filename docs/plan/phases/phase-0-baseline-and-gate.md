# Phase 0: Baseline & Gate

Status: next. Foundations only; no runtime change.

Goal: the shared prerequisites for every later phase — a v2 fix-completeness
gate, a client render-count probe, and a re-confirmed green baseline.

Findings: none (infrastructure).

## Slices

- [`v2-gate-scaffold.md`](slices/phase-0-baseline-and-gate/v2-gate-scaffold.md) -
  the v2 sibling of `src/ts/__tests__/fixCompletenessGate.test.ts`, parsing
  the v2 docs and seeding every scheduled ID as `PLANNED`.
- [`render-count-probe.md`](slices/phase-0-baseline-and-gate/render-count-probe.md) -
  a countable ParseMarkdown/reload probe for H3/Phase 5 proofs, plus the
  baseline re-run.

## Planned Shape

- The v1 gate stays frozen against
  `docs/archive/audit-stability-and-performance/`; the v2 gate is a new file
  (`fixCompletenessGateV2.test.ts`) so the two registries never mix.
- The v2 gate mirrors the v1 parser with adjusted shapes: finding universe
  from the v2 audit doc (`### H*/M*` headings, `| H*/M*/L*/I* |` index/table
  rows), routing from `active-risk-analysis.md` (`| ID | [N](phases/...) |`,
  `gated`, `no action`; ID classes `H/M/L/I/K`; `PENDING`/`DONE` markers),
  and the R1-R13 dismissed set.
- The render probe reuses the v1 harness idioms (counting wrappers, the
  large-corpus fixture) — see `serverLoadCostHarness.test.ts` and the
  counting-RegExp-subclass technique from the v1 Phase 7 tests.

## Exit Criteria

- [ ] v2 gate: every scheduled ID (H1-H3, M1-M22, L1-L11 minus L12, L13-L59,
      K1-K4) registered `PLANNED`; gated (L12) and no-action (I1-I18) ids
      recorded with reasons; doc/registry drift self-checks pass and a
      negative self-proof exists.
- [ ] Render-count probe: a test helper counts full-parse invocations across
      a simulated `ReloadGUIPointer` bump on N mounted messages; the pre-fix
      baseline (N parses per bump, caches wiped) is recorded.
- [ ] Baseline re-run recorded in
      [`../latest-verification.md`](../latest-verification.md): `pnpm test`,
      `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript checks.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
